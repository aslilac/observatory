import {
	ArchiveIcon,
	CodeXmlIcon,
	DiscIcon,
	FilmIcon,
	HourglassIcon,
	LayersIcon,
	type LucideIcon,
	WeightIcon,
} from "lucide-react";

type FinderInfo = {
	finder: Ob.Finder;
	label: string;
	description: string;
	icon: LucideIcon;
};

// What find offers before anything's typed: the kinds of things that tend
// to be worth cleaning up (src/scanner/find.rs), in the order they're
// listed.
export const FINDERS: FinderInfo[] = [
	{
		finder: "large",
		label: "Large files",
		description: "Files of 100 MB or more",
		icon: WeightIcon,
	},
	{
		finder: "old",
		label: "Untouched for a year",
		description: "Nothing in them has changed in a year",
		icon: HourglassIcon,
	},
	{
		finder: "videos",
		label: "Videos",
		description: "Movies, clips, and screen recordings",
		icon: FilmIcon,
	},
	{
		finder: "installers",
		label: "Installers",
		description: "Disk images and installer packages",
		icon: DiscIcon,
	},
	{
		finder: "archives",
		label: "Archives",
		description: "Zip files, tarballs, and the like",
		icon: ArchiveIcon,
	},
	{
		finder: "developer",
		label: "Developer files",
		description: "node_modules, build output, and the like",
		icon: CodeXmlIcon,
	},
	{
		finder: "caches",
		label: "Caches",
		description: "Apps make these again when they're gone",
		icon: LayersIcon,
	},
];

export function finderInfo(finder: Ob.Finder): FinderInfo {
	return FINDERS.find((f) => f.finder === finder)!;
}
