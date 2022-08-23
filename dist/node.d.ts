import { Options } from 'critters';
import { InlineConfig } from 'vite';

declare type RouteDefinition = string | {
    path?: string;
    children?: RouteDefinition[];
};

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
    root: string;
    html: string;
    preload?: string[];
    routes?: RouteDefinition[];
    head?: {
        lang?: string;
        title?: string;
        elements?: (string | {
            type: string;
            props: Record<string, any>;
        })[];
    };
    dirStyle?: "flat" | "nested";
}
declare type PrerenderFunction = (context: {
    route: string;
}) => Promise<PrerenderResult>;
declare type GetRoutesToPrerenderFunction = () => Promise<string[]>;
declare type EntryFileExports = {
    prerender: PrerenderFunction;
    getRoutesToPrerender?: GetRoutesToPrerenderFunction;
};
declare function build(cliOptions?: Partial<ViteSSGBuildOptions>, viteConfig?: InlineConfig): Promise<void>;

export { EntryFileExports, ViteSSGBuildOptions, build };
