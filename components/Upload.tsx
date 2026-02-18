import { useState, useRef, useCallback } from 'react';
import { Upload as UploadIcon, Loader2 } from 'lucide-react';
import {
  PROGRESS_INTERVAL_MS,
  PROGRESS_STEP,
  REDIRECT_DELAY_MS,
} from '../lib/constants';

interface UploadProps {
  isSignedIn: boolean;
  onComplete: (base64: string) => void | Promise<boolean | void>;
}

export default function Upload({ isSignedIn, onComplete }: UploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const processFile = useCallback(
    (file: File) => {
      if (!isSignedIn) {
        return;
      }

      setIsProcessing(true);
      setProgress(0);

      const reader = new FileReader();

      reader.onload = () => {
        const base64String = reader.result as string;

        // Start progress animation
        let currentProgress = 0;
        progressIntervalRef.current = setInterval(() => {
          currentProgress += PROGRESS_STEP;
          setProgress(Math.min(currentProgress, 100));

          if (currentProgress >= 100) {
            if (progressIntervalRef.current) {
              clearInterval(progressIntervalRef.current);
              progressIntervalRef.current = null;
            }
            setProgress(100);

            // Sau khi progress 100%: đợi REDIRECT_DELAY_MS rồi gọi onComplete, giữ Loading đến khi xong
            setTimeout(async () => {
              try {
                const result = onComplete(base64String);
                if (result && typeof (result as Promise<unknown>).then === 'function') {
                  await (result as Promise<boolean | void>);
                }
              } finally {
                setIsProcessing(false);
                setProgress(0);
              }
            }, REDIRECT_DELAY_MS);
          }
        }, PROGRESS_INTERVAL_MS);
      };

      reader.onerror = () => {
        setIsProcessing(false);
        setProgress(0);
        if (progressIntervalRef.current) {
          clearInterval(progressIntervalRef.current);
          progressIntervalRef.current = null;
        }
      };

      reader.readAsDataURL(file);
    },
    [isSignedIn, onComplete]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && isSignedIn) {
        processFile(file);
      }
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [isSignedIn, processFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);

      if (!isSignedIn) {
        return;
      }

      const file = e.dataTransfer.files?.[0];
      if (file) {
        processFile(file);
      }
    },
    [isSignedIn, processFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (isSignedIn) {
      setIsDragging(true);
    }
  }, [isSignedIn]);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  return (
    <div className="upload">
      {!isProcessing ? (
        <div
          className={`dropzone ${isDragging ? 'is-dragging' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/jpg"
            onChange={handleFileChange}
            className="drop-input"
            disabled={!isSignedIn}
          />
          <div className="drop-content">
            <div className="drop-icon">
              <UploadIcon className="w-6 h-6" />
            </div>
            <p>Upload your floor plan</p>
            <span className="help">
              {isSignedIn
                ? 'Drag and drop or click to browse'
                : 'Please sign in to upload files'}
            </span>
          </div>
        </div>
      ) : (
        <div className="upload-status">
          <div className="status-content">
            {progress < 100 ? (
              <>
                <div className="status-icon">
                  <UploadIcon className="w-6 h-6" />
                </div>
                <p className="status-text">Processing...</p>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="progress-text">{progress}%</span>
              </>
            ) : (
              <>
                <div className="status-icon">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
                <p className="status-text">Loading...</p>
                <p className="text-zinc-500 text-xs mt-1">
                  Creating project and redirecting...
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
