{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "out",
    "rootDir": "src",
    "strict": true,
    "moduleResolution": "node",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "types": ["node", "vscode"]
  },
  "include": [
    "src/extension.ts",
    "src/api.ts",
    "src/panel.ts",
    "src/detector.ts",
    "src/utils.ts",
    "src/detectors/**/*.ts"
  ],
  "exclude": [
    "src/content.ts"
  ]
}
