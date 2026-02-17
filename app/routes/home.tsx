import type { Route } from './+types/home';
import Navbar from '../../components/Navbar';
import { ArrowRightIcon, ArrowUpRight, Clock, Layers } from 'lucide-react';
import { Button } from 'components/ui/Button';
import { useOutletContext, useNavigate } from 'react-router';
import Upload from '../../components/Upload';

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
  const { isSignedIn } = useOutletContext<AuthContext>();
  const navigate = useNavigate();

  const handleUploadComplete = (base64: string) => {
    const newId = Date.now().toString();
    navigate(`/visualizer/${newId}`);
    return true;
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen">
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
            <div className="project-card group">
              <div className="preview">
                <img src="https://roomify-mlhuk267-dfwu1i.puter.site/projects/1770803585402/rendered.png" alt="Project" />

                <div className="badge">
                  <span>Community</span>
                </div>
              </div>

              <div className=" card-body">
                <div>
                  <h3>Project Manhattan</h3>
                  < div className="meta">
                    <Clock size={12} />
                    <span>{new Date('01.01.2027').toLocaleDateString()}</span>
                    <span>By Nghiem Pham</span>
                  </div>
                </div>
                <div className='arrow'><ArrowUpRight size={18} /></div>
              </div>

            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
