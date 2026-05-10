import { createRoot } from "react-dom/client";
import { Application } from "./Application";
import { NavigationProvider } from "./navigation";
import "./fonts";

const appRoot = createRoot(document.getElementById("app")!);

appRoot.render(
	<NavigationProvider>
		<Application />
	</NavigationProvider>,
);
