type Variant = "default" | "primary" | "danger";
type Size = "default" | "small";

export type ButtonProps = React.ComponentPropsWithoutRef<"button"> & {
	variant?: Variant;
	size?: Size;
};

const base =
	"inline-flex items-center gap-[6px] cursor-pointer rounded-button font-sans font-medium transition-colors active:translate-y-px " +
	"disabled:cursor-default disabled:translate-y-0 disabled:bg-fill disabled:text-muted disabled:border-line";

const variants: Record<Variant, string> = {
	default: "border border-line bg-background text-default hover:bg-fill",
	primary:
		"border border-transparent bg-default text-background hover:bg-default/85",
	danger:
		"border border-danger-border bg-danger-bg text-danger-fg hover:border-danger-fg/40",
};

const sizes: Record<Size, string> = {
	default: "px-[14px] py-[6px] text-[12px]",
	small: "px-[10px] py-[4px] text-[11px]",
};

export const Button: React.FC<ButtonProps> = ({
	variant = "default",
	size = "default",
	className,
	type = "button",
	...rest
}) => {
	return (
		<button
			type={type}
			className={`${base} ${variants[variant]} ${sizes[size]} ${className ?? ""}`}
			{...rest}
		/>
	);
};
