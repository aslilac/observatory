import { FolderIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type DragReceiverProps = {
	onDrop: (path: string) => void;
};

// Window-level drag-and-drop catcher: registers dragenter/dragover/leave/
// drop on document so any folder dropped over the window starts a scan,
// regardless of which child the cursor happens to be over. Renders the
// drop overlay while a file drag is in progress.
//
// dragenter and dragleave fire for every child boundary the pointer
// crosses, not just the document edge, so a counter ref tracks net depth
// and we only flip dragOver back to false when it returns to zero.
export const DragReceiver: React.FC<DragReceiverProps> = ({ onDrop }) => {
	const [dragOver, setDragOver] = useState(false);
	const counter = useRef(0);

	useEffect(() => {
		const isFileDrag = (e: DragEvent) =>
			Boolean(e.dataTransfer?.types.includes("Files"));

		const handleEnter = (e: DragEvent) => {
			if (!isFileDrag(e)) {
				return;
			}
			e.preventDefault();
			counter.current += 1;
			setDragOver(true);
		};

		const handleOver = (e: DragEvent) => {
			if (!isFileDrag(e)) {
				return;
			}
			e.preventDefault();
			if (e.dataTransfer) {
				e.dataTransfer.dropEffect = "copy";
			}
		};

		const handleLeave = (e: DragEvent) => {
			if (!isFileDrag(e)) {
				return;
			}
			counter.current = Math.max(0, counter.current - 1);
			if (counter.current === 0) {
				setDragOver(false);
			}
		};

		const handleDrop = (e: DragEvent) => {
			if (!isFileDrag(e)) {
				return;
			}
			e.preventDefault();
			counter.current = 0;
			setDragOver(false);
			const file = e.dataTransfer?.files[0];
			if (!file) {
				return;
			}
			const path = Ob.pathForFile(file);
			if (path) {
				onDrop(path);
			}
		};

		document.addEventListener("dragenter", handleEnter);
		document.addEventListener("dragover", handleOver);
		document.addEventListener("dragleave", handleLeave);
		document.addEventListener("drop", handleDrop);
		return () => {
			document.removeEventListener("dragenter", handleEnter);
			document.removeEventListener("dragover", handleOver);
			document.removeEventListener("dragleave", handleLeave);
			document.removeEventListener("drop", handleDrop);
		};
	}, [onDrop]);

	return dragOver ? <DropOverlay /> : null;
};

// The overlay sits on top of a fixed dark scrim regardless of the app
// theme, so its border/text/tint are pinned to the off-white from the
// light palette rather than `text-background` / `border-background` which
// would flip to dark in the dark theme and disappear against the scrim.
const DropOverlay: React.FC = () => (
	<div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-[rgba(25,25,35,0.6)] p-6">
		<div className="flex min-h-[60%] w-full flex-col items-center justify-center gap-3 rounded-modal border-[2.5px] border-dashed border-[#f9f9fd] bg-[rgba(249,249,253,0.08)] p-[40px] text-[#f9f9fd]">
			<FolderIcon size={64} strokeWidth={1} />
			<div className="text-[20px] font-semibold">Drop folder to scan</div>
			<div className="font-mono text-[12px] opacity-80">
				Anything you drop here will start a fresh scan.
			</div>
		</div>
	</div>
);
