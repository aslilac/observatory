import { createRoot } from "react-dom/client";

import { Application } from "./components/Application";
import { NavigationProvider } from "./navigation";
import "./resources/fonts";

const container = document.querySelector("#root");
if (!container) throw new Error("missing #root element");

createRoot(container).render(
	<NavigationProvider>
		<Application />
	</NavigationProvider>,
);
