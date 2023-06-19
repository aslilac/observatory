module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	testPathIgnorePatterns: ["<rootDir>/build/"],
	collectCoverage: true,
	coverageReporters: ["text", "cobertura"],
};
