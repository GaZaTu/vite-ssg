import { Options } from 'critters';
import { InlineConfig } from 'vite';

interface ViteSSGBuildOptions {
    /**
     * Rewrite scripts loading mode, only works for `type="module"`
     *
     * @default "sync"
     */
    script?: "sync" | "async" | "defer" | "async defer";
    /**
     * Built format
     *
     * @default "esm"
     */
    format?: "esm" | "cjs";
    /**
     * The path of main entry, relative to the project root
     *
     * @default "src/main.ts"
     */
    entry?: string;
    /**
     * Applying formatter to the generated index file.
     *
     * @default "none"
     */
    formatting?: "minify" | "prettify" | "none";
    /**
     * Vite environment mode
     */
    mode?: string;
    /**
     * Options for critters
     *
     * @see https://github.com/GoogleChromeLabs/critters
     */
    crittersOptions?: Options | false;
    /**
     * Size of generation processing queue.
     *
     * @default 20
     */
    concurrency?: number;
}
declare module "vite" {
    interface UserConfig {
        ssgOptions?: ViteSSGBuildOptions;
    }
}
interface PrerenderResult {
    html: string;
    preload?: string[];
    routes?: string[];
    head?: {
        lang?: string;
        title?: string;
        elements?: (string | {
            type: string;
            props: Record<string, any>;
        })[];
    };
}
declare type PrerenderFunction = (context: {
    route: string;
}) => Promise<PrerenderResult>;
interface SetupPrerenderResult {
    root: string;
    routes?: string[];
    dirStyle?: "flat" | "nested";
    csp?: {
        template: `${string}{{INLINE_SCRIPT_HASHES}}${string}`;
        fileName: string;
        fileType: "nginx-conf";
    };
}
declare type SetupPrerenderFunction = () => Promise<SetupPrerenderResult>;
declare type EntryFileExports = {
    prerender: PrerenderFunction;
    setupPrerender?: SetupPrerenderFunction;
};
declare function build(cliOptions?: Partial<ViteSSGBuildOptions>, viteConfig?: InlineConfig): Promise<void>;

export { EntryFileExports, ViteSSGBuildOptions, build };
