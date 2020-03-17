import React from "react";

export default ({ children, screen }) => (
	<>
		<div id="titlebar">
			<h1>Observatory</h1>
		</div>
		<div id="application-display" className={screen}>
			{children}
		</div>
	</>
);
