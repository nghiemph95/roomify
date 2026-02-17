import type { Route } from './+types/home';
import Navbar from '../../components/Navbar';
import { ArrowRightIcon, ArrowUpRight, Clock, Layers } from 'lucide-react';
import { Button } from 'components/ui/Button';
import { useOutletContext, useNavigate } from 'react-router';
import { useState, useEffect } from 'react';
import Upload from '../../components/Upload';
import { createProject } from '../../lib/puter.action';
import puter from '@heyputer/puter.js';

export function meta({ }: Route.MetaArgs) {
  return [
    { title: "New React Router App" },
    { name: "description", content: "Welcome to React Router!" },
  ];
}

type AuthContext = {
  isSignedIn: boolean;
  userName: string | null;
  userId: string | null;
};

export default function Home() {
  const { isSignedIn, userId } = useOutletContext<AuthContext>();
  const navigate = useNavigate();
  // State để quản lý danh sách projects
  // Lưu trữ các DesignItem đã được tạo để hiển thị trong projects section
  const [projets, setProjets] = useState<DesignItem[]>([]);
  // Loading state để hiển thị loading indicator khi đang load projects
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);

  /**
   * Load projects từ KV store
   * Tìm tất cả keys có prefix "project:" và load values
   */
  const loadProjects = async () => {
    if (!isSignedIn) {
      setProjets([]);
      return;
    }

    setIsLoadingProjects(true);
    try {
      // List tất cả keys có prefix "project:"
      // Pattern "project:*" sẽ match tất cả keys bắt đầu với "project:"
      const keysResult = (await puter.kv.list('project:*')) as
        | string[]
        | { keys?: string[]; cursor?: string }
        | Record<string, unknown>;

      // puter.kv.list() có thể trả về:
      // - Array of strings (keys only)
      // - Object với keys và values
      // - Object với pagination (cursor, keys, values)
      let keys: string[] = [];

      if (Array.isArray(keysResult)) {
        // Nếu là array → đó là list of keys
        keys = keysResult;
      } else if (keysResult && typeof keysResult === 'object') {
        // Nếu là object → có thể có keys property hoặc là key-value pairs
        if ('keys' in keysResult && Array.isArray(keysResult.keys)) {
          keys = keysResult.keys;
        } else {
          // Nếu là object với keys là properties
          keys = Object.keys(keysResult);
        }
      }

      // Load values cho từng key
      const projectsPromises = keys.map(async (key) => {
        try {
          const project = await puter.kv.get(key);
          return project as DesignItem;
        } catch (error) {
          console.warn(`Failed to load project ${key}:`, error);
          return null;
        }
      });

      const projects = await Promise.all(projectsPromises);
      // Filter out null values và sort theo timestamp (mới nhất trước)
      const validProjects = projects
        .filter((p): p is DesignItem => p !== null)
        .sort((a, b) => b.timestamp - a.timestamp);

      setProjets(validProjects);
    } catch (error) {
      console.error('Failed to load projects:', error);
      setProjets([]);
    } finally {
      setIsLoadingProjects(false);
    }
  };

  // Load projects khi component mount hoặc khi isSignedIn thay đổi
  useEffect(() => {
    loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  /**
   * Xử lý khi upload image hoàn thành
   *
   * FLOW:
   * 1. Tạo projectId mới (timestamp)
   * 2. Tạo tên project mặc định: "Residence {newId}"
   * 3. Tạo newItem với base64 image và các metadata
   * 4. Gọi createProject để upload images lên hosting và lưu vào KV store
   * 5. Nếu thành công → update state với project mới → navigate đến visualizer
   * 6. Nếu thất bại → log error và return false
   *
   * @param base64Image - Base64 string của image đã upload
   * @returns Promise<boolean> - true nếu thành công, false nếu thất bại
   */
  const handleUploadComplete = async (
    base64Image: string
  ): Promise<boolean> => {
    // BƯỚC 1: Tạo projectId mới
    // Sử dụng timestamp để đảm bảo unique ID
    const newId = Date.now().toString();

    // BƯỚC 2: Tạo tên project mặc định
    // Format: "Residence {newId}" để dễ nhận biết
    // Ví dụ: "Residence 1737123456789"
    const name = `Residence ${newId}`;

    // BƯỚC 3: Tạo newItem với đầy đủ DesignItem fields
    // DesignItem cần: id, name, sourceImage, timestamp, và các fields optional khác
    const newItem: DesignItem = {
      id: newId,
      name, // Tên project mặc định
      sourceImage: base64Image, // Base64 image từ upload
      renderedImage: undefined, // Rendered image (sẽ được set sau khi render)
      timestamp: Date.now(), // Timestamp hiện tại
      ownerId: userId || null, // User ID từ auth context (nếu có)
      sourcePath: null, // Path trong storage (không cần khi dùng hosting)
      renderedPath: null, // Path trong storage (không cần khi dùng hosting)
      publicPath: null, // Public path (không cần khi dùng hosting)
      isPublic: false, // Mặc định là private
    };

    // BƯỚC 3: Gọi createProject để upload images và lưu project
    // createProject() sẽ:
    // - Upload sourceImage lên hosting subdomain
    // - Upload renderedImage nếu có (trong trường hợp này là null)
    // - Resolve URLs thành hosted URLs
    // - Lưu project vào KV store với key: "project:{newId}"
    // - Return DesignItem với resolved URLs hoặc null nếu fail
    const saved = await createProject({
      item: newItem,
      visibility: 'private',
    });

    // BƯỚC 4: Kiểm tra kết quả
    // Nếu createProject return null → có lỗi xảy ra
    // → Log error và return false để Upload component biết có lỗi
    if (!saved) {
      console.error('Failed to create project');
      return false;
    }

    // BƯỚC 5: Verify image URL có thể access được (optional)
    // Đợi một chút để đảm bảo file đã được upload và sẵn sàng serve
    if (saved.sourceImage) {
      try {
        const response = await fetch(saved.sourceImage, { method: 'HEAD' });
        if (!response.ok) {
          console.warn('Image URL may not be ready yet:', saved.sourceImage);
        }
      } catch (err) {
        console.warn('Could not verify image URL:', err);
        // Vẫn tiếp tục navigate dù không verify được
      }
    }

    // BƯỚC 6: Update state với project mới
    // Thêm saved project vào đầu danh sách projets
    // Dùng functional update để đảm bảo state được update đúng
    // saved đã có resolved URLs (hosted URLs) từ createProject
    setProjets((prev) => [saved, ...prev]);
    
    // Reload projects từ KV store để đảm bảo sync với database
    // (Optional: có thể bỏ qua nếu muốn chỉ dùng local state)
    await loadProjects();

    // BƯỚC 7: Navigate đến visualizer với project data
    // Navigate với:
    // - Path: /visualizer/{newId} (projectId)
    // - State: initialImage, initialRendered, name để visualizer có thể load data
    navigate(`/visualizer/${newId}`, {
      state: {
        initialImage: saved.sourceImage, // Hosted URL của source image
        initialRendered: saved.renderedImage || null, // Hosted URL của rendered image (nếu có)
        name: saved.name || null, // Tên project
        ownerId: saved.ownerId || null, // Owner ID
      },
    });

    // Return true để Upload component biết thành công
    return true;
  };

  return (
    <div className="flex flex-col items-center min-h-screen pb-14">
      <Navbar />

      <section className="hero">
        <div className="announce">
          <div className="dot">
            <div className="pulse" />
          </div>
          <p>Introducing Roomify 2.0</p>
        </div>

        <h1>Build beautiful spaces at the speed of thought with Roomify</h1>

        <p className="subtitle">
          Roomify is an AI-first design environment that helps you visualize,
          render, and ship architectural projects faster than ever.
        </p>

        <div className="actions">
          <a href="#upload" className="cta">
            Start Building <ArrowRightIcon className="icon" />
          </a>

          <Button variant="outline" size="lg" className="demo">
            Watch Demo
          </Button>
        </div>


        <div id="upload" className="upload-shell">
          <div className="grid-overlay" />

          <div className="upload-card">
            <div className="upload-head">
              <div className="upload-icon">
                <Layers className="icon" />
              </div>

              <h3>Upload your floor plan</h3>
              <p>Supports JPG, PNG, formats up to 10MB</p>
            </div>

            <Upload isSignedIn={isSignedIn} onComplete={handleUploadComplete} />
          </div>
        </div>
      </section>

      <section className="projects">
        <div className="section-inner">
          <div className="section-head">
            <div className="copy">
              <h2>Projects</h2>
              <p>Your latest work and shared community projects, all in one place.</p>
            </div>
          </div>

          <div className="projects-grid">
            {isLoadingProjects ? (
              // Loading state: hiển thị khi đang load projects
              <div className="loading">
                <p>Loading projects...</p>
              </div>
            ) : projets.length === 0 ? (
              // Empty state: hiển thị khi chưa có projects
              <div className="empty">
                <p>No projects yet. Upload your first floor plan to get started!</p>
              </div>
            ) : (
              // Render projects từ state
              projets.map((project) => (
                <div
                  key={project.id}
                  className="project-card group"
                  onClick={() => {
                    navigate(`/visualizer/${project.id}`, {
                      state: {
                        initialImage: project.sourceImage,
                        initialRendered: project.renderedImage || null,
                        name: project.name || null,
                        ownerId: project.ownerId || null,
                      },
                    });
                  }}
                >
                  <div className="preview">
                    <img
                      src={project.renderedImage || project.sourceImage}
                      alt={project.name || 'Project'}
                    />

                    {project.isPublic && (
                      <div className="badge">
                        <span>Community</span>
                      </div>
                    )}
                  </div>

                  <div className="card-body">
                    <div>
                      <h3>{project.name || 'Untitled Project'}</h3>
                      <div className="meta">
                        <Clock size={12} />
                        <span>
                          {new Date(project.timestamp).toLocaleDateString()}
                        </span>
                        {project.sharedBy && (
                          <span>By {project.sharedBy}</span>
                        )}
                      </div>
                    </div>
                    <div className="arrow">
                      <ArrowUpRight size={18} />
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <footer className="fixed bottom-0 left-0 right-0 py-3 px-4 w-full border-t border-zinc-100 bg-background/95 backdrop-blur-sm z-10">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-zinc-400">
          <span>
            React · React Router · Tailwind · TypeScript · Puter (Auth · KV · AI · FS · Hosting)
          </span>
          <span className="text-zinc-300">·</span>
          <span>Created by Nghiem Pham</span>
        </div>
      </footer>
    </div>
  );
}
