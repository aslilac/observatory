import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { CheckIcon } from "lucide-react";

type CheckboxProps = {
	checked: boolean;
	onChange: () => void;
};

// Row-row hidden-until-hover checkbox. Visible when checked, fades in via
// the parent `.group` hover. Click is stopped from bubbling so toggling the
// box doesn't double-fire the row's own onClick.
export const Checkbox: React.FC<CheckboxProps> = ({ checked, onChange }) => (
	<BaseCheckbox.Root
		checked={checked}
		onCheckedChange={() => onChange()}
		onClick={(e) => e.stopPropagation()}
		className={`flex h-[14px] w-[14px] flex-shrink-0 cursor-pointer items-center justify-center rounded-[3px] border outline-none transition-opacity ${
			checked
				? "border-default bg-default text-background opacity-100"
				: "border-line bg-background opacity-0 group-hover:opacity-100"
		}`}
	>
		<BaseCheckbox.Indicator>
			<CheckIcon size={9} strokeWidth={3} />
		</BaseCheckbox.Indicator>
	</BaseCheckbox.Root>
);
