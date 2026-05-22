/// <reference types="vite/client" />

interface Window {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
}

interface FileSystemHandle {
  readonly kind: "file" | "directory";
  readonly name: string;
}

interface FileSystemFileHandle extends FileSystemHandle {
  readonly kind: "file";
  getFile(): Promise<File>;
}

interface FileSystemDirectoryHandle extends FileSystemHandle {
  readonly kind: "directory";
  values(): AsyncIterable<FileSystemHandle>;
  getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle>;
}
