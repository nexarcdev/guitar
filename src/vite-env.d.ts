/// <reference types="vite/client" />
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

interface ImportMetaEnv {
  /** Learn modules to build in besides the lesson: "all" or a comma list ("today,rhythm"). */
  readonly VITE_LEARN_MODULES?: string;
}

/** Learn modules built into this bundle (from VITE_LEARN_MODULES, see vite.config.ts). */
declare const __LEARN_TODAY__: boolean;
declare const __LEARN_CHANGES__: boolean;
declare const __LEARN_RHYTHM__: boolean;
declare const __LEARN_THEORY__: boolean;
declare const __LEARN_FRETBOARD__: boolean;
declare const __LEARN_EAR__: boolean;
declare const __LEARN_BAND__: boolean;
declare const __LEARN_SOLO__: boolean;
declare const __LEARN_JOURNEY__: boolean;
