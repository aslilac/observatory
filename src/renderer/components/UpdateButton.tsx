import { ArrowUpRightIcon, RotateCwIcon } from "lucide-react";
import { useUpdate } from "#/state";

// In the title bar, once there's a new version: a restart into it, if it's
// downloaded, or else its release page (see src/main/updates.ts).
export const UpdateButton: React.FC = () => {
	const update = useUpdate();
	if (!update) {
		return null;
	}

	const downloaded = update.status === "downloaded";
	return (
		<button
			type="button"
			onClick={() => void Ob.applyUpdate()}
			title={
				downloaded
					? "Restart Observatory to finish updating"
					: `Observatory ${update.version} is out. Get it from GitHub`
			}
			className="flex h-[22px] cursor-pointer items-center gap-[5px] rounded-button px-[7px] text-muted hover:bg-fill hover:text-default"
		>
			<span className="size-[6px] rounded-full bg-meter" />
			{downloaded ? "Restart to update" : `Version ${update.version} is out`}
			{downloaded ? <RotateCwIcon size={11} /> : <ArrowUpRightIcon size={11} />}
		</button>
	);
};
