import type { Route } from './+types/home';
import Navbar from '../../components/Navbar';
import { ArrowRightIcon, ArrowUpRight, Clock, Layers } from 'lucide-react';
import { Button } from 'components/ui/Button';
import { useOutletContext, useNavigate } from 'react-router';
import { useState, useEffect, useRef } from 'react';
import Upload from '../../components/Upload';
import { createProject, getProjects } from '../../lib/puter.action';

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
  // Ref đánh dấu đang trong quá trình tạo project (upload + createProject + navigate)
  const isCreatingProjectRef = useRef(false);

  /**
   * Load projects từ Puter Worker (cùng nguồn với createProject).
   */
  const loadProjects = async () => {
    if (!isSignedIn) {
      setProjets([]);
      return;
    }

    setIsLoadingProjects(true);
    try {
      const projects = await getProjects();
      const sorted = [...projects].sort((a, b) => b.timestamp - a.timestamp);
      setProjets(sorted);
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
    isCreatingProjectRef.current = true;
    try {
      // BƯỚC 1: Tạo projectId mới
      const newId = Date.now().toString();
      const name = `Residence ${newId}`;

      // BƯỚC 2: Tạo newItem với đầy đủ DesignItem fields
      const newItem: DesignItem = {
        id: newId,
        name,
        sourceImage: base64Image,
        renderedImage: undefined,
        timestamp: Date.now(),
        ownerId: userId || null,
        sourcePath: null,
        renderedPath: null,
        publicPath: null,
        isPublic: false,
      };

      // BƯỚC 3: Gọi createProject để upload images và lưu project
      const saved = await createProject({
        item: newItem,
        visibility: 'private',
      });

      if (!saved) {
        console.error('Failed to create project');
        return false;
      }

      // BƯỚC 4: Verify image URL (optional)
      if (saved.sourceImage) {
        try {
          const response = await fetch(saved.sourceImage, { method: 'HEAD' });
          if (!response.ok) {
            console.warn('Image URL may not be ready yet:', saved.sourceImage);
          }
        } catch (err) {
          console.warn('Could not verify image URL:', err);
        }
      }

      // BƯỚC 5: Update state và reload projects
      setProjets((prev) => [saved, ...prev]);
      await loadProjects();

      // BƯỚC 6: Navigate đến visualizer
      navigate(`/visualizer/${newId}`, {
        state: {
          initialImage: saved.sourceImage,
          initialRendered: saved.renderedImage || null,
          name: saved.name || null,
          ownerId: saved.ownerId || null,
        },
      });

      return true;
    } finally {
      isCreatingProjectRef.current = false;
    }
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
                      src={
                        project.image3D ||
                        project.renderedImage ||
                        project.sourceImage
                      }
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
