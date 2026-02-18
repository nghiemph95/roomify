import type { Route } from './+types/visualizer.$id';
import { useParams, useNavigate, useLocation } from 'react-router';
import { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Download,
  Share2,
  Loader2,
  ZoomIn,
  ZoomOut,
  Maximize,
  RotateCcw,
  GripVertical,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import puter from '@heyputer/puter.js';
import { getProject, updateProject } from '../../lib/puter.action';
import { getOrCreateHostingConfig, uploadImageToHosting } from '../../lib/puter.hosting';
import { generate3DView } from '../../lib/ai.action';

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

  // State để quản lý 3D view generation
  const [image3D, setImage3D] = useState<HTMLImageElement | null>(null);
  const [isLoadingSaved3D, setIsLoadingSaved3D] = useState(false);
  const [isGenerating3D, setIsGenerating3D] = useState(false);
  const [error3D, setError3D] = useState<string | null>(null);

  // State để quản lý view controls
  const [viewMode, setViewMode] = useState<'split' | 'single'>('split'); // 'split' hoặc 'single'
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom2D, setZoom2D] = useState(1);
  const [zoom3D, setZoom3D] = useState(1);
  const [pan2D, setPan2D] = useState({ x: 0, y: 0 });
  const [pan3D, setPan3D] = useState({ x: 0, y: 0 });
  const [isDragging2D, setIsDragging2D] = useState(false);
  const [isDragging3D, setIsDragging3D] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [comparisonSlider, setComparisonSlider] = useState(50); // 0-100 for slider position

  // Refs cho image containers
  const image2DRef = useRef<HTMLDivElement>(null);
  const image3DRef = useRef<HTMLDivElement>(null);

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
        // Ưu tiên load từ server (getProject) để có đủ image3D → tránh render lại 3D tốn credit
        if (puter.auth.isSignedIn()) {
          const projectData = await getProject(id);

          if (projectData) {
            setProject(projectData);
            setIsLoading(false);
            return;
          }
        }

        // Fallback: dùng location state khi chưa đăng nhập hoặc project chưa có trên server (vd. vừa upload)
        const state = location.state as any;
        const initialImage = state?.initialImage || state?.state?.initialImage;
        const initialRendered = state?.initialRendered || state?.state?.initialRendered;
        const name = state?.name || state?.state?.name;
        const ownerId = state?.ownerId || state?.state?.ownerId;

        if (initialImage) {
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
        } else if (!puter.auth.isSignedIn()) {
          setError('Please sign in to view projects');
        } else {
          setError('Project not found');
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

  // Nếu project đã có image3D (đã lưu trước đó) → load lên state, không cần generate lại
  useEffect(() => {
    if (!project?.image3D || image3D) {
      if (!project?.image3D) setIsLoadingSaved3D(false);
      return;
    }

    let cancelled = false;
    setIsLoadingSaved3D(true);
    setError3D(null);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!cancelled) {
        setImage3D(img);
        setIsLoadingSaved3D(false);
      }
    };
    img.onerror = () => {
      if (!cancelled) {
        console.warn('Failed to load saved image3D URL:', project.image3D);
        setIsLoadingSaved3D(false);
        setError3D('Could not load saved 3D view. You can regenerate.');
      }
    };
    img.src = project.image3D;

    return () => {
      cancelled = true;
    };
  }, [project?.id, project?.image3D, image3D]);

  // Generate 3D view khi project được load và chưa có 3D (chưa có state và chưa có URL đã lưu)
  useEffect(() => {
    if (
      project?.sourceImage &&
      !isLoading &&
      !image3D &&
      !project?.image3D &&
      !isGenerating3D
    ) {
      const generate3D = async () => {
        setIsGenerating3D(true);
        setError3D(null);

        const timeoutMs = 90_000;
        const timeoutId = setTimeout(() => {
          setIsGenerating3D(false);
          setError3D('Request timed out. You can try again or check your balance.');
        }, timeoutMs);

        try {
          const generatedImage = await generate3DView(project.sourceImage, {
            testMode: true, // true = không trừ credits (ảnh mẫu)
          });
          setImage3D(generatedImage);

          // Lưu ảnh 3D lên hosting và cập nhật project để lần sau không phải generate lại
          const hosting = await getOrCreateHostingConfig();
          const hosted = await uploadImageToHosting({
            hosting,
            url: generatedImage.src,
            projectId: project.id,
            label: 'image3d',
          });
          if (hosted?.url) {
            const updated = await updateProject({ ...project, image3D: hosted.url });
            if (updated) setProject(updated);
          }
        } catch (err) {
          const errorMessage =
            err instanceof Error ? err.message : 'Failed to generate 3D view';
          setError3D(errorMessage);
          console.error('Failed to generate 3D view:', err);
        } finally {
          clearTimeout(timeoutId);
          setIsGenerating3D(false);
        }
      };

      generate3D();
    }
  }, [project, isLoading, image3D, isGenerating3D]);

  // Listen to fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Zoom bằng con lăn chuột khi hover lên vùng 2D/3D (chỉ trong Split View; Single View không zoom)
  useEffect(() => {
    const handleWheel = (e: WheelEvent, type: '2d' | '3d') => {
      if (viewMode === 'single') {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      if (type === '2d') {
        setZoom2D((prev) => {
          const newZoom = prev + delta;
          return Math.max(0.5, Math.min(3, newZoom));
        });
      } else {
        setZoom3D((prev) => {
          const newZoom = prev + delta;
          return Math.max(0.5, Math.min(3, newZoom));
        });
      }
    };

    const el2D = image2DRef.current;
    if (el2D) {
      const wheelHandler = (e: WheelEvent) => handleWheel(e, '2d');
      el2D.addEventListener('wheel', wheelHandler, { passive: false });
      return () => el2D.removeEventListener('wheel', wheelHandler);
    }
  }, [project, image3D, viewMode]);

  useEffect(() => {
    const handleWheel = (e: WheelEvent, type: '2d' | '3d') => {
      if (viewMode === 'single') {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      if (type === '3d') {
        setZoom3D((prev) => {
          const newZoom = prev + delta;
          return Math.max(0.5, Math.min(3, newZoom));
        });
      }
    };

    const el3D = image3DRef.current;
    if (el3D) {
      const wheelHandler = (e: WheelEvent) => handleWheel(e, '3d');
      el3D.addEventListener('wheel', wheelHandler, { passive: false });
      return () => el3D.removeEventListener('wheel', wheelHandler);
    }
  }, [image3D, viewMode]);

  // Handle export action
  const handleExport = () => {
    if (!project) return;

    // Ưu tiên export 3D image nếu có
    if (image3D) {
      const link = document.createElement('a');
      link.href = image3D.src;
      const projectName = project.name || 'project';
      link.download = `${projectName}-3d-${id}.png`;
      link.click();
      return;
    }

    // Fallback: export rendered image hoặc source image
    if (!project.renderedImage && !project.sourceImage) return;

    const imageUrl = project.renderedImage || project.sourceImage;
    const link = document.createElement('a');
    link.href = imageUrl;
    const projectName = project.name || 'project';
    link.download = `${projectName}-${id}.png`;
    link.click();
  };

  // Handle share action
  const handleShare = async () => {
    if (!project) return;

    // TODO: Implement share functionality
  };

  // Handle zoom controls
  const handleZoom = (type: '2d' | '3d', direction: 'in' | 'out') => {
    const step = 0.2;
    if (type === '2d') {
      setZoom2D((prev) => {
        const newZoom = direction === 'in' ? prev + step : prev - step;
        return Math.max(0.5, Math.min(3, newZoom)); // Limit between 0.5x and 3x
      });
    } else {
      setZoom3D((prev) => {
        const newZoom = direction === 'in' ? prev + step : prev - step;
        return Math.max(0.5, Math.min(3, newZoom));
      });
    }
  };

  // Handle reset view
  const handleResetView = (type: '2d' | '3d' | 'all') => {
    if (type === '2d' || type === 'all') {
      setZoom2D(1);
      setPan2D({ x: 0, y: 0 });
    }
    if (type === '3d' || type === 'all') {
      setZoom3D(1);
      setPan3D({ x: 0, y: 0 });
    }
  };

  // Handle regenerate 3D view
  const handleRegenerate3D = async () => {
    if (!project?.sourceImage || isGenerating3D) {
      return;
    }

    setIsGenerating3D(true);
    setError3D(null);
    setImage3D(null); // Clear old image

    const timeoutMs = 90_000;
    const timeoutId = setTimeout(() => {
      setIsGenerating3D(false);
      setError3D('Request timed out. You can try again or check your balance.');
    }, timeoutMs);

    try {
      const generatedImage = await generate3DView(project.sourceImage, {
        testMode: true, // không trừ credits
      });
      setImage3D(generatedImage);
      setZoom3D(1);
      setPan3D({ x: 0, y: 0 });

      // Lưu ảnh 3D lên hosting và cập nhật project (giống auto-generate)
      const hosting = await getOrCreateHostingConfig();
      const hosted = await uploadImageToHosting({
        hosting,
        url: generatedImage.src,
        projectId: project.id,
        label: 'image3d',
      });
      if (hosted?.url) {
        const updated = await updateProject({ ...project, image3D: hosted.url });
        if (updated) setProject(updated);
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to generate 3D view';
      setError3D(errorMessage);
      console.error('Failed to regenerate 3D view:', err);
    } finally {
      clearTimeout(timeoutId);
      setIsGenerating3D(false);
    }
  };

  // Handle fullscreen
  const handleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  // Handle mouse drag for panning
  const handleMouseDown = (
    type: '2d' | '3d',
    e: React.MouseEvent<HTMLDivElement>
  ) => {
    // Prevent default drag behavior để tránh ghost image
    e.preventDefault();
    e.stopPropagation();

    // Chỉ enable drag khi không click vào controls hoặc buttons
    const target = e.target as HTMLElement;
    if (
      target.closest('button') ||
      target.closest('[style*="position: absolute"]') ||
      target.tagName === 'BUTTON'
    ) {
      return;
    }

    if (type === '2d') {
      setIsDragging2D(true);
    } else {
      setIsDragging3D(true);
    }
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (type: '2d' | '3d', e: React.MouseEvent<HTMLDivElement>) => {
    // Mouse move sẽ được handle bởi global listener trong useEffect
    // Không cần xử lý ở đây nữa
  };

  const handleMouseUp = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setIsDragging2D(false);
    setIsDragging3D(false);
  };

  // Global mouse handlers để handle drag khi mouse ra ngoài element
  // Sử dụng ref để track dragStart để tránh dependency issues
  const dragStartRef = useRef(dragStart);
  useEffect(() => {
    dragStartRef.current = dragStart;
  }, [dragStart]);

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (isDragging2D) {
        e.preventDefault();
        const currentStart = dragStartRef.current;
        const deltaX = e.clientX - currentStart.x;
        const deltaY = e.clientY - currentStart.y;
        setPan2D((prev) => ({
          x: prev.x + deltaX,
          y: prev.y + deltaY,
        }));
        setDragStart({ x: e.clientX, y: e.clientY });
      } else if (isDragging3D) {
        e.preventDefault();
        const currentStart = dragStartRef.current;
        const deltaX = e.clientX - currentStart.x;
        const deltaY = e.clientY - currentStart.y;
        setPan3D((prev) => ({
          x: prev.x + deltaX,
          y: prev.y + deltaY,
        }));
        setDragStart({ x: e.clientX, y: e.clientY });
      }
    };

    const handleGlobalMouseUp = () => {
      setIsDragging2D(false);
      setIsDragging3D(false);
    };

    if (isDragging2D || isDragging3D) {
      document.addEventListener('mousemove', handleGlobalMouseMove, { passive: false });
      document.addEventListener('mouseup', handleGlobalMouseUp);
      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging2D, isDragging3D]);

  // Handle download both images
  const handleDownloadBoth = () => {
    if (!project) return;

    const sourceImageUrl = project.renderedImage || project.sourceImage;

    // Download 2D image
    if (sourceImageUrl) {
      const link2D = document.createElement('a');
      link2D.href = sourceImageUrl;
      link2D.download = `${project.name || 'project'}-2d-${id}.png`;
      link2D.click();
    }

    // Download 3D image
    if (image3D) {
      setTimeout(() => {
        const link3D = document.createElement('a');
        link3D.href = image3D.src;
        link3D.download = `${project.name || 'project'}-3d-${id}.png`;
        link3D.click();
      }, 100);
    }
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
                {image3D
                  ? '3D visualization'
                  : project.renderedImage
                    ? 'Rendered visualization'
                    : 'Source floor plan'}
              </p>
            </div>

            <div className="panel-actions">
              {/* View mode toggle */}
              {image3D && (project.renderedImage || project.sourceImage) && (
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => {
                    const next = viewMode === 'split' ? 'single' : 'split';
                    setViewMode(next);
                    if (next === 'single') {
                      setZoom2D(1);
                      setZoom3D(1);
                      setPan2D({ x: 0, y: 0 });
                      setPan3D({ x: 0, y: 0 });
                    }
                  }}
                  title="Toggle view mode"
                >
                  {viewMode === 'split' ? 'Single View' : 'Split View'}
                </Button>
              )}

              {/* Download both */}
              {image3D && (project.renderedImage || project.sourceImage) && (
                <Button
                  variant="ghost"
                  size="md"
                  onClick={handleDownloadBoth}
                  title="Download both 2D and 3D images"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download Both
                </Button>
              )}

              <Button
                variant="primary"
                size="md"
                className="export"
                onClick={handleExport}
                disabled={!image3D && !project.renderedImage && !project.sourceImage}
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
              // Lấy source image để hiển thị (rendered hoặc source)
              const sourceImageUrl =
                project.renderedImage || project.sourceImage;

              // Nếu có cả 3D và 2D → hiển thị với controls
              if (image3D && sourceImageUrl) {
                // Single view mode - hiển thị comparison slider
                if (viewMode === 'single') {
                  return (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        background: 'var(--color-surface-highlight, #f3f4f6)',
                      }}
                    >
                      {/* Khung chung: vuông, căn giữa, 2D và 3D cùng tỉ lệ trong khung này */}
                      <div
                        style={{
                          position: 'relative',
                          width: 'min(100%, 80vmin)',
                          aspectRatio: '1',
                          maxHeight: '100%',
                          flexShrink: 0,
                        }}
                      >
                        {/* 2D Image (background) - cùng khung */}
                        <div
                          ref={image2DRef}
                          style={{
                            position: 'absolute',
                            inset: 0,
                            overflow: 'hidden',
                            cursor: isDragging2D ? 'grabbing' : 'grab',
                            userSelect: 'none',
                            WebkitUserSelect: 'none',
                            borderRadius: '8px',
                          }}
                          onMouseDown={(e) => handleMouseDown('2d', e)}
                          onDragStart={(e) => e.preventDefault()}
                        >
                          <img
                            src={sourceImageUrl}
                            alt={`2D floor plan of ${project.name || 'project'}`}
                            draggable={false}
                            style={{
                              transform: `translate(${pan2D.x}px, ${pan2D.y}px) scale(${zoom2D})`,
                              transformOrigin: 'center center',
                              transition: isDragging2D ? 'none' : 'transform 0.2s',
                              width: '100%',
                              height: '100%',
                              objectFit: 'contain',
                              objectPosition: 'center',
                              userSelect: 'none',
                              WebkitUserSelect: 'none',
                              pointerEvents: 'none',
                            }}
                            onError={(e) => {
                              console.error('Failed to load 2D image');
                              const img = e.currentTarget;
                              img.style.border = '2px solid red';
                              img.style.opacity = '0.5';
                            }}
                            onDragStart={(e) => e.preventDefault()}
                          />
                        </div>

                        {/* 3D Image (overlay, cùng khung, clip theo slider) */}
                        <div
                          ref={image3DRef}
                          style={{
                            position: 'absolute',
                            inset: 0,
                            overflow: 'hidden',
                            clipPath: `inset(0 ${100 - comparisonSlider}% 0 0)`,
                            cursor: isDragging3D ? 'grabbing' : 'grab',
                            userSelect: 'none',
                            WebkitUserSelect: 'none',
                            borderRadius: '8px',
                          }}
                          onMouseDown={(e) => handleMouseDown('3d', e)}
                          onDragStart={(e) => e.preventDefault()}
                        >
                          <img
                            src={image3D.src}
                            alt={`3D view of ${project.name || 'floor plan'}`}
                            draggable={false}
                            style={{
                              transform: `translate(${pan3D.x}px, ${pan3D.y}px) scale(${zoom3D})`,
                              transformOrigin: 'center center',
                              transition: isDragging3D ? 'none' : 'transform 0.2s',
                              width: '100%',
                              height: '100%',
                              objectFit: 'contain',
                              objectPosition: 'center',
                              userSelect: 'none',
                              WebkitUserSelect: 'none',
                              pointerEvents: 'none',
                            }}
                            onError={(e) => {
                              console.error('Failed to load 3D image');
                              e.currentTarget.style.display = 'none';
                            }}
                            onDragStart={(e) => e.preventDefault()}
                          />
                        </div>

                        {/* Comparison Slider - trong khung */}
                        <div
                          role="slider"
                          aria-label="Compare 2D and 3D view"
                          tabIndex={0}
                          style={{
                            position: 'absolute',
                            top: 0,
                            bottom: 0,
                            left: `${comparisonSlider}%`,
                            transform: 'translateX(-50%)',
                            width: '24px',
                            marginLeft: '-12px',
                            cursor: 'ew-resize',
                            zIndex: 10,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const container = e.currentTarget.parentElement as HTMLElement;
                            const handleMove = (moveEvent: MouseEvent) => {
                              const rect = container?.getBoundingClientRect();
                              if (rect) {
                                const percent = ((moveEvent.clientX - rect.left) / rect.width) * 100;
                                setComparisonSlider(Math.max(0, Math.min(100, percent)));
                              }
                            };
                            const handleUp = () => {
                              document.removeEventListener('mousemove', handleMove);
                              document.removeEventListener('mouseup', handleUp);
                            };
                            document.addEventListener('mousemove', handleMove);
                            document.addEventListener('mouseup', handleUp);
                          }}
                        >
                          <div
                            style={{
                              width: '4px',
                              height: '80%',
                              background: 'rgba(255, 255, 255, 0.95)',
                              boxShadow: '0 0 10px rgba(0,0,0,0.3)',
                              borderRadius: '2px',
                              pointerEvents: 'none',
                            }}
                          />
                          <div
                            style={{
                              position: 'absolute',
                              top: '50%',
                              left: '50%',
                              transform: 'translate(-50%, -50%)',
                              width: '40px',
                              height: '40px',
                              borderRadius: '50%',
                              background: 'white',
                              border: '2px solid rgba(0,0,0,0.2)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                              pointerEvents: 'none',
                            }}
                          >
                            <GripVertical size={20} className="text-zinc-600" />
                          </div>
                        </div>

                        {/* Labels */}
                        <div
                          style={{
                            position: 'absolute',
                            top: 12,
                            left: 12,
                            background: 'rgba(0, 0, 0, 0.7)',
                            color: 'white',
                            padding: '6px 12px',
                            borderRadius: '6px',
                            fontSize: '12px',
                            fontWeight: 600,
                            backdropFilter: 'blur(4px)',
                            zIndex: 5,
                          }}
                        >
                          2D Plan
                        </div>
                        <div
                          style={{
                            position: 'absolute',
                            top: 12,
                            right: 12,
                            background: 'rgba(0, 0, 0, 0.7)',
                            color: 'white',
                            padding: '6px 12px',
                            borderRadius: '6px',
                            fontSize: '12px',
                            fontWeight: 600,
                            backdropFilter: 'blur(4px)',
                            zIndex: 5,
                          }}
                        >
                          3D View
                        </div>
                      </div>
                    </div>
                  );
                }

                // Split view mode - side-by-side với zoom/pan controls
                return (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '16px',
                      width: '100%',
                      height: '100%',
                    }}
                  >
                    {/* 2D Image với controls */}
                    <div
                      ref={image2DRef}
                      style={{
                        position: 'relative',
                        height: '100%',
                        overflow: 'hidden',
                        borderRadius: '8px',
                        background: 'white',
                        cursor: isDragging2D ? 'grabbing' : 'grab',
                        userSelect: 'none',
                        WebkitUserSelect: 'none',
                      }}
                      onMouseDown={(e) => handleMouseDown('2d', e)}
                      onDragStart={(e) => e.preventDefault()}
                    >
                      <img
                        src={sourceImageUrl}
                        alt={`2D floor plan of ${project.name || 'project'}`}
                        className="render-img"
                        draggable={false}
                        style={{
                          transform: `translate(${pan2D.x}px, ${pan2D.y}px) scale(${zoom2D})`,
                          transformOrigin: 'center center',
                          transition: isDragging2D ? 'none' : 'transform 0.2s',
                          height: '100%',
                          objectFit: 'contain',
                          userSelect: 'none',
                          WebkitUserSelect: 'none',
                          pointerEvents: 'none', // Prevent image from capturing mouse events
                        }}
                        onError={(e) => {
                          console.error('Failed to load 2D image');
                          const img = e.currentTarget;
                          img.style.border = '2px solid red';
                          img.style.opacity = '0.5';
                        }}
                        onDragStart={(e) => e.preventDefault()}
                      />
                      {/* 2D Controls */}
                      <div
                        style={{
                          position: 'absolute',
                          top: 12,
                          left: 12,
                          display: 'flex',
                          gap: '8px',
                          zIndex: 10,
                        }}
                      >
                        <div
                          style={{
                            background: 'rgba(0, 0, 0, 0.7)',
                            color: 'white',
                            padding: '6px 12px',
                            borderRadius: '6px',
                            fontSize: '12px',
                            fontWeight: 600,
                            backdropFilter: 'blur(4px)',
                          }}
                        >
                          2D Plan
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            gap: '4px',
                            background: 'rgba(0, 0, 0, 0.7)',
                            borderRadius: '6px',
                            padding: '4px',
                            backdropFilter: 'blur(4px)',
                          }}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleZoom('2d', 'out');
                            }}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'white',
                              cursor: 'pointer',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                            title="Zoom out"
                          >
                            <ZoomOut size={16} />
                          </button>
                          <span
                            style={{
                              color: 'white',
                              fontSize: '11px',
                              padding: '4px 8px',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                          >
                            {Math.round(zoom2D * 100)}%
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleZoom('2d', 'in');
                            }}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'white',
                              cursor: 'pointer',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                            title="Zoom in"
                          >
                            <ZoomIn size={16} />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* 3D Image với controls */}
                    <div
                      ref={image3DRef}
                      style={{
                        position: 'relative',
                        height: '100%',
                        overflow: 'hidden',
                        borderRadius: '8px',
                        background: 'white',
                        cursor: isDragging3D ? 'grabbing' : 'grab',
                        userSelect: 'none',
                        WebkitUserSelect: 'none',
                      }}
                      onMouseDown={(e) => handleMouseDown('3d', e)}
                      onDragStart={(e) => e.preventDefault()}
                    >
                      <img
                        src={image3D.src}
                        alt={`3D view of ${project.name || 'floor plan'}`}
                        className="render-img"
                        draggable={false}
                        style={{
                          transform: `translate(${pan3D.x}px, ${pan3D.y}px) scale(${zoom3D})`,
                          transformOrigin: 'center center',
                          transition: isDragging3D ? 'none' : 'transform 0.2s',
                          height: '100%',
                          objectFit: 'contain',
                          userSelect: 'none',
                          WebkitUserSelect: 'none',
                          pointerEvents: 'none', // Prevent image from capturing mouse events
                        }}
                        onError={(e) => {
                          console.error('Failed to load 3D image');
                          e.currentTarget.style.display = 'none';
                        }}
                        onDragStart={(e) => e.preventDefault()}
                      />
                      {/* 3D Controls */}
                      <div
                        style={{
                          position: 'absolute',
                          top: 12,
                          left: 12,
                          display: 'flex',
                          gap: '8px',
                          zIndex: 10,
                        }}
                      >
                        <div
                          style={{
                            background: 'rgba(0, 0, 0, 0.7)',
                            color: 'white',
                            padding: '6px 12px',
                            borderRadius: '6px',
                            fontSize: '12px',
                            fontWeight: 600,
                            backdropFilter: 'blur(4px)',
                          }}
                        >
                          3D View
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            gap: '4px',
                            background: 'rgba(0, 0, 0, 0.7)',
                            borderRadius: '6px',
                            padding: '4px',
                            backdropFilter: 'blur(4px)',
                          }}
                        >
                          <button
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleZoom('3d', 'out');
                            }}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'white',
                              cursor: 'pointer',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                            title="Zoom out"
                          >
                            <ZoomOut size={16} />
                          </button>
                          <span
                            style={{
                              color: 'white',
                              fontSize: '11px',
                              padding: '4px 8px',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                          >
                            {Math.round(zoom3D * 100)}%
                          </span>
                          <button
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleZoom('3d', 'in');
                            }}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'white',
                              cursor: 'pointer',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                            title="Zoom in"
                          >
                            <ZoomIn size={16} />
                          </button>
                          <button
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRegenerate3D();
                            }}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'white',
                              cursor: isGenerating3D ? 'not-allowed' : 'pointer',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              opacity: isGenerating3D ? 0.5 : 1,
                            }}
                            title="Regenerate 3D view"
                            disabled={isGenerating3D}
                          >
                            <RotateCcw size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }

              // Đang load ảnh 3D đã lưu (không tốn credit)
              if (isLoadingSaved3D && sourceImageUrl) {
                return (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '16px',
                      width: '100%',
                      height: '100%',
                    }}
                  >
                    <div style={{ position: 'relative', height: '100%' }}>
                      <img
                        src={sourceImageUrl}
                        alt={`2D floor plan of ${project.name || 'project'}`}
                        className="render-img"
                        style={{ height: '100%', objectFit: 'contain' }}
                        onError={(e) => {
                          const img = e.currentTarget;
                          img.style.border = '2px solid red';
                          img.style.opacity = '0.5';
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          top: 12,
                          left: 12,
                          background: 'rgba(0, 0, 0, 0.7)',
                          color: 'white',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
                          backdropFilter: 'blur(4px)',
                        }}
                      >
                        2D Plan
                      </div>
                    </div>
                    <div className="render-placeholder">
                      <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
                      <p className="text-zinc-700 font-medium">Loading saved 3D view...</p>
                      <p className="text-zinc-500 text-sm mt-2">No credits used</p>
                    </div>
                  </div>
                );
              }

              // Nếu đang generate 3D → hiển thị 2D với loading indicator
              if (isGenerating3D && sourceImageUrl) {
                return (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '16px',
                      width: '100%',
                      height: '100%',
                    }}
                  >
                    {/* 2D Image */}
                    <div style={{ position: 'relative', height: '100%' }}>
                      <img
                        src={sourceImageUrl}
                        alt={`2D floor plan of ${project.name || 'project'}`}
                        className="render-img"
                        style={{ height: '100%', objectFit: 'contain' }}
                        onError={(e) => {
                          console.error('Failed to load 2D image');
                          const img = e.currentTarget;
                          img.style.border = '2px solid red';
                          img.style.opacity = '0.5';
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          top: 12,
                          left: 12,
                          background: 'rgba(0, 0, 0, 0.7)',
                          color: 'white',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
                          backdropFilter: 'blur(4px)',
                        }}
                      >
                        2D Plan
                      </div>
                    </div>

                    {/* Loading state cho 3D */}
                    <div className="render-placeholder">
                      <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
                      <p className="text-zinc-700 font-medium">Generating 3D view...</p>
                      <p className="text-zinc-500 text-sm mt-2">
                        This may take a few moments
                      </p>
                    </div>
                  </div>
                );
              }

              // Nếu có error khi generate 3D → hiển thị 2D với warning
              if (error3D && sourceImageUrl) {
                return (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '16px',
                      width: '100%',
                      height: '100%',
                    }}
                  >
                    {/* 2D Image */}
                    <div style={{ position: 'relative', height: '100%' }}>
                      <img
                        src={sourceImageUrl}
                        alt={`2D floor plan of ${project.name || 'project'}`}
                        className="render-img"
                        style={{ height: '100%', objectFit: 'contain' }}
                        onError={(e) => {
                          console.error('Failed to load 2D image');
                          const img = e.currentTarget;
                          img.style.border = '2px solid red';
                          img.style.opacity = '0.5';
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          top: 12,
                          left: 12,
                          background: 'rgba(0, 0, 0, 0.7)',
                          color: 'white',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
                          backdropFilter: 'blur(4px)',
                        }}
                      >
                        2D Plan
                      </div>
                    </div>

                    {/* Error state cho 3D */}
                    <div className="render-placeholder">
                      <div
                        style={{
                          background: 'rgba(239, 68, 68, 0.1)',
                          border: '2px solid rgba(239, 68, 68, 0.3)',
                          borderRadius: '8px',
                          padding: '24px',
                          textAlign: 'center',
                        }}
                      >
                        <p className="text-red-600 font-medium mb-2">
                          3D Generation Failed
                        </p>
                        <p className="text-zinc-500 text-sm">{error3D}</p>
                      </div>
                    </div>
                  </div>
                );
              }

              // Fallback: chỉ hiển thị 2D image nếu không có 3D (với zoom/pan controls)
              if (sourceImageUrl) {
                return (
                  <div
                    ref={image2DRef}
                    style={{
                      position: 'relative',
                      width: '100%',
                      height: '100%',
                      overflow: 'hidden',
                      cursor: isDragging2D ? 'grabbing' : 'grab',
                      userSelect: 'none',
                      WebkitUserSelect: 'none',
                    }}
                    onMouseDown={(e) => handleMouseDown('2d', e)}
                    onDragStart={(e) => e.preventDefault()}
                  >
                    <img
                      src={sourceImageUrl}
                      alt={project.name || 'Source floor plan'}
                      className="render-img"
                      draggable={false}
                      style={{
                        transform: `translate(${pan2D.x}px, ${pan2D.y}px) scale(${zoom2D})`,
                        transformOrigin: 'center center',
                        transition: isDragging2D ? 'none' : 'transform 0.2s',
                        height: '100%',
                        objectFit: 'contain',
                        userSelect: 'none',
                        WebkitUserSelect: 'none',
                        pointerEvents: 'none', // Prevent image from capturing mouse events
                      }}
                      onError={(e) => {
                        console.error('Failed to load source image');
                        const img = e.currentTarget;
                        img.style.border = '2px solid red';
                        img.style.opacity = '0.5';
                      }}
                      onDragStart={(e) => e.preventDefault()}
                    />
                    {/* Zoom controls */}
                    <div
                      style={{
                        position: 'absolute',
                        top: 12,
                        right: 12,
                        display: 'flex',
                        gap: '4px',
                        background: 'rgba(0, 0, 0, 0.7)',
                        borderRadius: '6px',
                        padding: '4px',
                        backdropFilter: 'blur(4px)',
                        zIndex: 10,
                      }}
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleZoom('2d', 'out');
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'white',
                          cursor: 'pointer',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          display: 'flex',
                          alignItems: 'center',
                        }}
                        title="Zoom out"
                      >
                        <ZoomOut size={16} />
                      </button>
                      <span
                        style={{
                          color: 'white',
                          fontSize: '11px',
                          padding: '4px 8px',
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        {Math.round(zoom2D * 100)}%
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleZoom('2d', 'in');
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'white',
                          cursor: 'pointer',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          display: 'flex',
                          alignItems: 'center',
                        }}
                        title="Zoom in"
                      >
                        <ZoomIn size={16} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFullscreen();
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'white',
                          cursor: 'pointer',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          display: 'flex',
                          alignItems: 'center',
                        }}
                        title="Fullscreen"
                      >
                        <Maximize size={16} />
                      </button>
                    </div>
                  </div>
                );
              }

              // Fallback: placeholder
              return (
                <div className="render-placeholder">
                  <p className="text-zinc-500">No image available</p>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
