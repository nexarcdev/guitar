/// <reference types="vite/client" />
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

interface ImportMetaEnv {
  /** Learn modules to build in besides the lesson: "all" or a comma list ("today,rhythm"). */
  readonly VITE_LEARN_MODULES?: string;
}
