import type { Route } from './+types/visualizer.$id';
import { useParams, useNavigate, useLocation } from 'react-router';
import { useState, useEffect } from 'react';
import { ArrowLeft, Download, Share2, Loader2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import puter from '@heyputer/puter.js';

export function meta({ params }: Route.MetaArgs) {
  return [
    { title: `Visualizer - ${params.id} | Roomify` },
    {
      name: 'description',
      content: 'View and interact with your rendered floor plan visualization.',
    },
  ];
}

/**
 * Visualizer component - Hiển thị và quản lý project visualization
 *
 * MỤC ĐÍCH:
 * - Hiển thị source image và rendered image của project
 * - Load project data từ KV store hoặc location state
 * - Cung cấp actions: Export, Share
 * - Navigate về home khi click exit
 *
 * FLOW:
 * 1. Lấy projectId từ URL params
 * 2. Thử load project từ location state (nếu navigate từ home)
 * 3. Nếu không có → load từ KV store với key "project:{projectId}"
 * 4. Hiển thị source image và rendered image (nếu có)
 * 5. Handle loading và error states
 */
export default function Visualizer() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // State để quản lý project data
  const [project, setProject] = useState<DesignItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load project data từ location state hoặc KV store
  useEffect(() => {
    const loadProject = async () => {
      if (!id) {
        setError('Project ID is required');
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        // BƯỚC 1: Thử lấy từ location state (nếu navigate từ home)
        // Location state có thể chứa: initialImage, initialRendered, name, ownerId
        const state = location.state as any;

        // Check cả state.initialImage và state.state?.initialImage (React Router v7 có thể nest state)
        const initialImage = state?.initialImage || state?.state?.initialImage;
        const initialRendered = state?.initialRendered || state?.state?.initialRendered;
        const name = state?.name || state?.state?.name;
        const ownerId = state?.ownerId || state?.state?.ownerId;

        if (initialImage) {
          // Nếu có state → tạo project object từ state
          // Đây là trường hợp navigate từ home sau khi upload
          const projectFromState: DesignItem = {
            id,
            name: name || null,
            sourceImage: initialImage,
            renderedImage: initialRendered || null,
            timestamp: Date.now(),
            ownerId: ownerId || null,
            sourcePath: null,
            renderedPath: null,
            publicPath: null,
            isPublic: false,
          };
          setProject(projectFromState);
          setIsLoading(false);
          return;
        }

        // BƯỚC 2: Nếu không có state → load từ KV store
        // Key format: "project:{id}"
        if (puter.auth.isSignedIn()) {
          const projectKey = `project:${id}`;
          const projectData = await puter.kv.get(projectKey);

          if (projectData) {
            const project = projectData as DesignItem;
            setProject(project);
          } else {
            setError('Project not found');
          }
        } else {
          setError('Please sign in to view projects');
        }
      } catch (err) {
        console.error('Failed to load project:', err);
        setError('Failed to load project');
      } finally {
        setIsLoading(false);
      }
    };

    loadProject();
  }, [id, location.state]);

  // Debug: Log project state changes (PHẢI ĐẶT TRƯỚC CÁC EARLY RETURNS)
  useEffect(() => {
    // Verify image URL khi project được load (silent check)
    if (project?.sourceImage && !isLoading) {
      fetch(project.sourceImage, { method: 'HEAD', mode: 'no-cors' }).catch(() => {
        // Silent fail - chỉ log warning nếu cần
      });
    }
  }, [project, isLoading, error]);

  // Handle export action
  const handleExport = () => {
    if (!project?.renderedImage && !project?.sourceImage) return;

    const imageUrl = project.renderedImage || project.sourceImage;
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `${project.name || 'project'}-${id}.png`;
    link.click();
  };

  // Handle share action
  const handleShare = async () => {
    if (!project) return;

    // TODO: Implement share functionality
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="visualizer-route loading">
        <Loader2 className="w-6 h-6 animate-spin" />
        <p>Loading project...</p>
      </div>
    );
  }

  // Error state
  if (error || !project) {
    return (
      <div className="visualizer-route">
        <div className="flex flex-col items-center justify-center min-h-screen gap-4">
          <h2 className="text-2xl font-serif">Project Not Found</h2>
          <p className="text-zinc-500">{error || 'Project does not exist'}</p>
          <Button variant="primary" onClick={() => navigate('/')}>
            Back to Home
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="visualizer">
      {/* Topbar với brand và exit button */}
      <div className="topbar">
        <div className="brand" onClick={() => navigate('/')}>
          <span className="name">Roomify</span>
        </div>

        <button className="exit" onClick={() => navigate('/')}>
          <ArrowLeft className="icon" />
          Back to Home
        </button>
      </div>

      {/* Main content */}
      <div className="content">
        {/* Panel chứa project visualization */}
        <div className="panel">
          {/* Panel header với meta và actions */}
          <div className="panel-header">
            <div className="panel-meta">
              <p>Project ID</p>
              <h2>{project.name || `Project ${id}`}</h2>
              <p className="note">
                {project.renderedImage
                  ? 'Rendered visualization'
                  : 'Source floor plan'}
              </p>
            </div>

            <div className="panel-actions">
              <Button
                variant="primary"
                size="md"
                className="export"
                onClick={handleExport}
                disabled={!project.renderedImage && !project.sourceImage}
              >
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
              <Button
                variant="secondary"
                size="md"
                className="share"
                onClick={handleShare}
              >
                <Share2 className="w-4 h-4 mr-2" />
                Share
              </Button>
            </div>
          </div>

          {/* Render area để hiển thị images */}
          <div className="render-area">
            {(() => {
              if (project.renderedImage) {
                // Nếu có rendered image → hiển thị rendered image
                return (
                  <img
                    src={project.renderedImage}
                    alt={project.name || 'Rendered visualization'}
                    className="render-img"
                    onError={(e) => {
                      console.error('Failed to load rendered image:', project.renderedImage);
                      // Fallback to source image nếu rendered image fail
                      if (project.sourceImage) {
                        e.currentTarget.src = project.sourceImage;
                      } else {
                        e.currentTarget.style.display = 'none';
                      }
                    }}
                  />
                );
              } else if (project.sourceImage) {
                // Nếu chưa có rendered → hiển thị source image
                return (
                  <>
                    <img
                      src={project.sourceImage}
                      alt={project.name || 'Source floor plan'}
                      className="render-img"
                      onError={(e) => {
                        console.error('❌ Failed to load source image:', project.sourceImage);
                        console.error('Error event:', e);
                        // Không ẩn image ngay, để user thấy có vấn đề
                        // Thay vào đó, thêm error indicator
                        const img = e.currentTarget;
                        img.style.border = '2px solid red';
                        img.style.opacity = '0.5';
                        
                        // Log thêm thông tin để debug
                        fetch(project.sourceImage, { method: 'HEAD' })
                          .then((res) => {
                            console.error('Image URL response:', {
                              status: res.status,
                              statusText: res.statusText,
                              headers: Object.fromEntries(res.headers.entries()),
                            });
                          })
                          .catch((fetchErr) => {
                            console.error('Failed to fetch image URL:', fetchErr);
                          });
                      }}
                    />
                  </>
                );
              } else {
                // Fallback: placeholder
                return (
                  <div className="render-placeholder">
                    <p className="text-zinc-500">No image available</p>
                  </div>
                );
              }
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
