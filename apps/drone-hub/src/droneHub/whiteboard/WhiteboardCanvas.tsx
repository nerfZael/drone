import { Excalidraw } from '@excalidraw/excalidraw';
import type { AppState, BinaryFiles, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';

type WhiteboardCanvasProps = {
  initialData: ExcalidrawInitialDataState;
  onChange: (elements: readonly any[], appState: AppState, files: BinaryFiles) => void;
};

export function WhiteboardCanvas({ initialData, onChange }: WhiteboardCanvasProps) {
  return (
    <Excalidraw
      initialData={initialData}
      onChange={onChange}
      UIOptions={{
        canvasActions: {
          loadScene: false,
          saveToActiveFile: false,
        },
      }}
    />
  );
}
