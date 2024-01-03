import type * as math from '@xeokit/math';
import type { GLAbstractTexture } from "./GLAbstractTexture";
import type { TextureCompressedParams } from "@xeokit/core";
/**
 * Represents a WebGL2 texture.
 */
export declare class GLTexture implements GLAbstractTexture {
    private gl;
    private target;
    private format;
    private type;
    private internalFormat;
    private premultiplyAlpha;
    private flipY;
    private unpackAlignment;
    private wrapS;
    private wrapT;
    private wrapR;
    private texture;
    private allocated;
    private minFilter;
    private magFilter;
    private encoding;
    constructor(params: {
        gl: WebGL2RenderingContext;
        target?: number;
        format?: number;
        type?: number;
        wrapS?: number;
        wrapT?: number;
        wrapR?: number;
        preloadColor?: math.FloatArrayParam;
        premultiplyAlpha?: boolean;
        flipY?: boolean;
    });
    setPreloadColor(value: math.FloatArrayParam): void;
    setTarget(target: number): void;
    setImage(image: HTMLImageElement, props?: {
        format?: number;
        internalFormat?: number;
        encoding?: number;
        type?: number;
        flipY?: boolean;
        premultiplyAlpha?: boolean;
        unpackAlignment?: number;
        minFilter?: number;
        magFilter?: number;
        wrapS?: number;
        wrapT?: number;
        wrapR?: number;
    }): void;
    setCompressedData(params: TextureCompressedParams): void;
    setProps(props: {
        format?: number;
        internalFormat?: number;
        encoding?: number;
        type?: number;
        flipY?: boolean;
        premultiplyAlpha?: boolean;
        unpackAlignment: number;
        minFilter?: number;
        magFilter?: number;
        wrapS?: number;
        wrapT?: number;
        wrapR?: number;
    }): void;
    _uploadProps(props: {
        format?: number;
        internalFormat?: number;
        encoding?: number;
        type?: number;
        flipY?: boolean;
        premultiplyAlpha?: boolean;
        unpackAlignment: number;
        minFilter?: number;
        magFilter?: number;
        wrapS?: number;
        wrapT?: number;
        wrapR?: number;
    }): void;
    bind(unit: number): boolean;
    unbind(unit: number): void;
    destroy(): void;
}
