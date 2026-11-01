// from release-plugin.ts: the release the site offers, or null in dev if GitHub
// couldn't be reached
declare module "virtual:release" {
	const release: import("./release").Release | null;
	export default release;
}
