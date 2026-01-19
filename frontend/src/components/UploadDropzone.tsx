import { ChangeEvent, DragEvent, useRef, useState } from 'react';

type UploadDropzoneProps = {
  onUpload: (file: File) => Promise<void>;
  isUploading: boolean;
  errorMessage: string | null;
};

export default function UploadDropzone({ onUpload, isUploading, errorMessage }: UploadDropzoneProps) {
  const [isDraggedOver, setIsDraggedOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }
    const file = files.item(0);
    if (!file) {
      return;
    }
    await onUpload(file);
  };

  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggedOver(false);
    await handleFiles(event.dataTransfer.files);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggedOver(true);
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggedOver(false);
  };

  const onFileInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    await handleFiles(event.target.files);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  return (
    <div className="upload">
      <div
        className={`dropzone${isDraggedOver ? ' dropzone-active' : ''}`}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            inputRef.current?.click();
          }
        }}
        onClick={() => inputRef.current?.click()}
      >
        <p>{isUploading ? 'Uploading…' : 'Drag & drop a GIF/WebP or click to choose one.'}</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/gif,image/webp"
        onChange={onFileInputChange}
        style={{ display: 'none' }}
      />
      {errorMessage ? <p className="error">{errorMessage}</p> : null}
    </div>
  );
}
