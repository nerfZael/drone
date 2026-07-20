import { Excalidraw } from '@excalidraw/excalidraw';
import type { AppState, BinaryFiles, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';

type WhiteboardCanvasProps = {
  initialData: ExcalidrawInitialDataState;
  onChange: (elements: readonly any[], appState: AppState, files: BinaryFiles) => void;
};

export function WhiteboardCanvas({ initialData, onChange }: WhiteboardCanvasProps) {
  return (
    <div className="dh-whiteboard-theme h-full w-full">
      <Excalidraw
        theme="dark"
        initialData={initialData}
        onChange={onChange}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
          },
        }}
      />
    </div>
  );
}
