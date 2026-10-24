// The app's icon as this platform draws it: the building on macOS, and the
// aperture in Windows' or GNOME's style elsewhere. The about window has no
// preload, so the main process passes the platform in the URL instead.
import darwin from "../../../../build-resources/about/darwin.png";
import linux from "../../../../build-resources/about/linux.png";
import win32 from "../../../../build-resources/about/win32.png";

const icons: Record<string, string> = { darwin, linux, win32 };
const platform = new URLSearchParams(location.search).get("platform") ?? "";
const icon = document.querySelector<HTMLImageElement>(".icon");
if (icon) {
	icon.src = icons[platform] ?? linux;
}
