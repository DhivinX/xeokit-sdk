import {Map} from "@xeokit/utils";
import {createVec3} from "@xeokit/matrix";
import type {FloatArrayParam} from "@xeokit/math";
import {LinesPrimitive, PointsPrimitive, SolidPrimitive, SurfacePrimitive, TrianglesPrimitive} from "@xeokit/constants";

import type {Renderer, RendererViewObject, View, Viewer, ViewObject} from "@xeokit/viewer";

import {KTX2TextureTranscoder} from "@xeokit/ktx2";
import {RenderContext} from "./RenderContext";
import {FastColorTrianglesRenderer} from "./FastColorTrianglesRenderer";
import {getExtension, GLRenderBuffer, WEBGL_INFO} from "@xeokit/webglutils";
import {RENDER_PASSES} from "./RENDER_PASSES";
import type {Pickable} from "./Pickable";
import {WebGLRendererModel} from "./WebGLRendererModel";
import type {Layer} from "./Layer";
import type {Capabilities, Component, TextureTranscoder} from "@xeokit/core";
import {SDKError} from "@xeokit/core";
import type {Scene, SceneModel} from "@xeokit/scene";
import {WebGLTileManager} from "./WebGLTileManager";


const ua = navigator.userAgent.match(/(opera|chrome|safari|firefox|msie|mobile)\/?\s*(\.?\d+(\.\d+)*)/i);
const isSafari = (ua && ua[1].toLowerCase() === "safari");

/**
 * WebGL-based rendering strategy for a {@link @xeokit/viewer!Viewer | Viewer}.
 *
 * See {@link @xeokit/webglrenderer} for usage.
 */
export class WebGLRenderer implements Renderer {

    /**
     * A RendererViewObject is an interface through which a ViewObject can push updates
     * to its object representation within the Renderer.
     */
    rendererViewObjects: { [key: string]: RendererViewObject };

    tileManager: WebGLTileManager | null;

    #sceneModels: { [key: string]: SceneModel };
    #viewer: Viewer;
    #view: View;
    #renderContext: RenderContext;
    #canvasTransparent: boolean;
    #transparentEnabled: boolean;
    #edgesEnabled: boolean;
    #imageDirty: boolean;
    #saoEnabled: boolean;
    #pbrEnabled: boolean;
    #backgroundColor: FloatArrayParam;
    #rendererModels: { [key: string]: WebGLRendererModel };
    #layerList: Layer[];
    #layerListDirty: boolean;
    #stateSortDirty: boolean;
    #pickIDs = new Map({});
    #saoDepthRenderBuffer: GLRenderBuffer;
    // #renderBufferManager: GLRenderBufferManager;
    #extensionHandles: any;
    #logarithmicDepthBufferEnabled: boolean;
    #alphaDepthMask: boolean;
    #occlusionTester: any;
    // #saoOcclusionRenderer: null | SAOOcclusionRenderer;
    // #saoDepthLimitedBlurRenderer: SAODepthLimitedBlurRenderer;
    #textureTranscoder: TextureTranscoder;

    // @ts-ignore
    #layerRenderers: {
        // colorPoints: ColorPointsLayerRenderer;
        colorTriangles: FastColorTrianglesRenderer;
        // qualityColorTriangles: QualityColorTrianglesRenderer;
        // colorLines: ColorLinesLayerRenderer;
        // silhouettePoints: SilhouettePointsRenderer;
        // silhouetteTriangles: SilhouetteTrianglesLayerRenderer;
        // silhouetteLines: SilhouetteLinesRenderer;
    };
    #viewMatrixDirty: boolean;

    /**
     Creates a WebGLRenderer.

     @param params Configs
     @param params.textureTranscoder Injects an optional transcoder that will be used internally by {@link rendererModel.createTexture}
     to convert transcoded texture data. The transcoder is only required when we'll be providing transcoded data
     to {@link rendererModel.createTexture}. We assume that all transcoded texture data added to a  ````rendererModel````
     will then be in a format supported by this transcoder.
     */
    constructor(params: {
        textureTranscoder?: TextureTranscoder
    }) {

        this.rendererViewObjects = {};
        this.tileManager = null;

        this.#sceneModels = {};
        this.#textureTranscoder = params.textureTranscoder || new KTX2TextureTranscoder({});
        this.#canvasTransparent = false;
        this.#alphaDepthMask = false;
        this.#extensionHandles = {};
        this.#pickIDs = new Map({});
        this.#layerList = [];
        this.#layerListDirty = true;
        this.#stateSortDirty = true;
        this.#imageDirty = true;
        this.#transparentEnabled = true;
        this.#edgesEnabled = true;
        this.#saoEnabled = true;
        this.#pbrEnabled = true;
        this.#backgroundColor = createVec3();
        this.#occlusionTester = null; // Lazy-created in #addMarker()

        // this.#saoDepthRenderBuffer = null;
        // this.#renderBufferManager = null;
        this.#logarithmicDepthBufferEnabled = false;
        this.#rendererModels = {};
        this.#viewMatrixDirty = true;
    }

    /**
     * TODO
     * @internal
     */
    getCapabilities(capabilities: Capabilities): void {
        capabilities.maxViews = 1;
        const canvasElement = document.createElement('canvas');
        let gl;
        try {
            gl = canvasElement.getContext("webgl2");
        } catch (e) {
            console.error('Failed to get a WebGL context');
        }
        if (gl) {
            capabilities.astcSupported = !!getExtension(gl, 'WEBGL_compressed_texture_astc');
            capabilities.etc1Supported = true; // WebGL
            capabilities.etc2Supported = !!getExtension(gl, 'WEBGL_compressed_texture_etc');
            capabilities.dxtSupported = !!getExtension(gl, 'WEBGL_compressed_texture_s3tc');
            capabilities.bptcSupported = !!getExtension(gl, 'EXT_texture_compression_bptc');
            capabilities.pvrtcSupported = !!(getExtension(gl, 'WEBGL_compressed_texture_pvrtc') || getExtension(gl, 'WEBKIT_WEBGL_compressed_texture_pvrtc'));
        }
    }

    /**
     * TODO
     * @internal
     */
    attachViewer(viewer: Viewer): void {
        this.#viewer = viewer;
        this.#textureTranscoder.init(this.#viewer.capabilities);
    }

    /**
     * TODO
     * @internal
     */
    attachView(view: View): number {
        if (this.#renderContext) {
            throw "Only one View allowed with WebGLRenderer (see WebViewerCapabilities.maxViews)";
        }
        this.#view = view;
        const WEBGL_CONTEXT_NAMES = ["webgl2"];
        const canvasElement = view.canvasElement;
        const contextAttr = {};
        let gl: WebGL2RenderingContext | null = null;
        for (let i = 0; !gl && i < WEBGL_CONTEXT_NAMES.length; i++) {
            try {  // @ts-ignore
                gl = canvasElement.getContext(WEBGL_CONTEXT_NAMES[i], contextAttr);
            } catch (e) { // Try with next context name
            }
        }
        if (!gl) {
            console.error('Failed to get a WebGL2 context');
            //  view.events.fire("webglContextFailed", true, true);
            return 0;
        }
        if (gl) {
            gl.hint(gl.FRAGMENT_SHADER_DERIVATIVE_HINT, gl.NICEST);
        }
        this.#renderContext = new RenderContext(this.#viewer, this.#view, gl);
        this.tileManager = new WebGLTileManager({
            camera: view.camera,
            gl
        });
        this.#layerRenderers = {
            //       colorPoints: new ColorPointsLayerRenderer(this.#renderContext),
            colorTriangles: new FastColorTrianglesRenderer(this.#renderContext),
            // qualityColorTriangles: new QualityColorTrianglesRenderer(this.#renderContext),
            // colorLines: new ColorLinesLayerRenderer(this.#renderContext),
            // silhouettePoints: new SilhouettePointsRenderer(this.#renderContext),
            // silhouetteTriangles: new SilhouetteTrianglesLayerRenderer(this.#renderContext),
            // silhouetteLines: new SilhouetteLinesRenderer(this.#renderContext)
        };
        view.camera.onViewMatrix.sub(() => {
            this.#viewMatrixDirty = true;
        });
        return 0;
    }

    /**
     * TODO
     * @internal
     */
    detachView(viewIndex: number): void { // Nop
    }

    /**
     * TODO
     * @internal
     */
    attachSceneModel(sceneModel: SceneModel): void {
        if (!this.#renderContext) {
            throw new SDKError("Must attach a View before you attach a SceneModel");
        }
        const rendererModel = new WebGLRendererModel({
            id: sceneModel.id,
            sceneModel,
            view: this.#view,
            textureTranscoder: this.#textureTranscoder,
            webglRenderer: this,
            renderContext: this.#renderContext
        });
        this.#rendererModels[rendererModel.id] = rendererModel;
        this.#attachRendererViewObjects(rendererModel);
        this.#layerListDirty = true;
        rendererModel.onDestroyed.one((component: Component) => {
            const rendererModel = this.#rendererModels[component.id];
            delete this.#rendererModels[component.id];
            this.#detachRendererViewObjects(rendererModel);
            this.#layerListDirty = true;
        });
        sceneModel.rendererModel = rendererModel;
    }

    /**
     * TODO
     * @internal
     */
    detachSceneModel(sceneModel:SceneModel): void {
        if (this.#rendererModels[sceneModel.id]) {
            const rendererModel = this.#rendererModels[sceneModel.id];
            delete this.#rendererModels[sceneModel.id];
            this.#detachRendererViewObjects(rendererModel);
            this.#layerListDirty = true;
            sceneModel.rendererModel = null;
        }
    }

    #attachRendererViewObjects(rendererModel: WebGLRendererModel) {
        const rendererViewObjects = rendererModel.rendererViewObjects;
        for (let id in rendererViewObjects) {
            this.rendererViewObjects[id] = rendererViewObjects[id];
        }
    }

    #detachRendererViewObjects(rendererModel: WebGLRendererModel) {
        const rendererViewObjects = rendererModel.rendererViewObjects;
        for (let id in rendererViewObjects) {
            delete this.rendererViewObjects[id];
        }
    }

    /**
     * @private
     */
    attachPickable(pickable: Pickable): number { // @ts-ignore
        return this.#pickIDs.addItem(pickable);
    }

    /**
     * @private
     */
    detachPickable(pickId: number) {
        this.#pickIDs.removeItem(pickId);
    }

    /**
     * TODO
     * @internal
     */
    setImageDirty(viewIndex?: number) {
        this.#imageDirty = true;
    }

    /**
     * TODO
     * @internal
     */
    setBackgroundColor(viewIndex: number, color: FloatArrayParam): void { // @ts-ignore
        this.#backgroundColor.set(color);
        this.#imageDirty = true;
    }

    /**
     * TODO
     * @internal
     */
    setEdgesEnabled(viewIndex: number, enabled: boolean): void {
        this.#edgesEnabled = enabled;
        this.#imageDirty = true;
    }

    /**
     * TODO
     * @internal
     */
    setPBREnabled(viewIndex: number, enabled: boolean): void {
        this.#pbrEnabled = enabled;
        this.#imageDirty = true;
    }

    /**
     * TODO
     * @internal
     */
    getSAOSupported(): boolean {
        return isSafari && WEBGL_INFO.SUPPORTED_EXTENSIONS["OES_standard_derivatives"];
    }

    /**
     * TODO
     * @internal
     */
    setSAOEnabled(viewIndex: number, enabled: boolean): void {
        this.#saoEnabled = enabled;
        this.#imageDirty = true;
    }

    /**
     * TODO
     * @internal
     */
    setTransparentEnabled(viewIndex: number, enabled: boolean): void {
        this.#transparentEnabled = enabled;
        this.#imageDirty = true;
    }

    /**
     * TODO
     * @internal
     */
    clear(viewIndex: number) {
        const gl = this.#renderContext.gl;
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        if (this.#canvasTransparent) {
            gl.clearColor(1, 1, 1, 1);
        } else {
            gl.clearColor(this.#backgroundColor[0], this.#backgroundColor[1], this.#backgroundColor[2], 1.0);
        }
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    };

    /**
     * TODO
     * @internal
     */
    needsRebuild(viewIndex?: number): void {
        for (let rendererId in this.#layerRenderers) {
            // @ts-ignore
            this.#layerRenderers[rendererId].needRebuild();
        }
    }

    /**
     * TODO
     * @internal
     */
    needsRender(viewIndex?: number): boolean {
        return (this.#imageDirty || this.#layerListDirty || this.#stateSortDirty);
    }

    /**
     * TODO
     * @internal
     */
    render(viewIndex: number, params: {
        force?: boolean;
    }) {
        params = params || {};
        if (params.force) {
            this.#imageDirty = true;
        }
        if (this.#viewMatrixDirty) {
            (<WebGLTileManager>this.tileManager).refreshMatrices();
            this.#viewMatrixDirty = false;
        }
        this.#updateLayerList();
        if (this.#imageDirty) {
            this.#draw({clear: true});
            this.#imageDirty = false;
        }
    }

    /**
     * TODO
     * @internal
     */
    pickSceneObject(viewIndex: number, params: {}): ViewObject | null {
        return null;
    };

    #updateLayerList() {
        if (this.#layerListDirty) {
            this.#buildLayerList();
            this.#layerListDirty = false;
            this.#stateSortDirty = true;
        }
        if (this.#stateSortDirty) {
            //     this.#sortLayerList();
            this.#stateSortDirty = false;
            this.#imageDirty = true;
        }
    }

    #buildLayerList() {
        let lenDrawableList = 0;
        for (let id in this.#rendererModels) {
            const webGLSceneModelRenderer = this.#rendererModels[id];
            for (let i = 0, len = webGLSceneModelRenderer.layerList.length; i < len; i++) {
                this.#layerList[lenDrawableList++] = webGLSceneModelRenderer.layerList[i];
            }
        }
        this.#layerList.length = lenDrawableList;
    }

    #draw(params: {
        clear: boolean;
    }) {
        this.#activateExtensions();
        if (this.#saoEnabled && this.#view.sao.possible) {
            this.#drawSAOBuffers(params);
        }
        this.#drawColor(params);
    }

    #activateExtensions() {
        if (WEBGL_INFO.SUPPORTED_EXTENSIONS["OES_element_index_uint"]) {
            this.#extensionHandles.OES_element_index_uint = this.#renderContext.gl.getExtension("OES_element_index_uint");
        }
        if (this.#logarithmicDepthBufferEnabled && WEBGL_INFO.SUPPORTED_EXTENSIONS["EXT_frag_depth"]) {
            this.#extensionHandles.EXT_frag_depth = this.#renderContext.gl.getExtension('EXT_frag_depth');
        }
        if (WEBGL_INFO.SUPPORTED_EXTENSIONS["WEBGL_depth_texture"]) {
            this.#extensionHandles.WEBGL_depth_texture = this.#renderContext.gl.getExtension('WEBGL_depth_texture');
        }
    }

    #drawSAOBuffers(params: {
        clear: boolean;
    }) {
        // const sao = this.#view.sao;
        // const saoDepthRenderBuffer = this.#renderBufferManager.getRenderBuffer("saoDepth", {
        //     depthTexture: WEBGL_INFO.SUPPORTED_EXTENSIONS["WEBGL_depth_texture"]
        // });
        // this.#saoDepthRenderBuffer.bind();
        // this.#saoDepthRenderBuffer.clear();
        // this.#drawDepth(params);
        // this.#saoDepthRenderBuffer.unbind();
        // // Render occlusion buffer
        // const occlusionRenderBuffer1 = this.#renderBufferManager.getRenderBuffer("saoOcclusion");
        // occlusionRenderBuffer1.bind();
        // occlusionRenderBuffer1.clear();
        // this.#saoOcclusionRenderer.render(saoDepthRenderBuffer);
        // occlusionRenderBuffer1.unbind();
        // if (sao.blur) {
        //     // Horizontally blur occlusion buffer 1 into occlusion buffer 2
        //     const occlusionRenderBuffer2 = this.#renderBufferManager.getRenderBuffer("saoOcclusion2");
        //     occlusionRenderBuffer2.bind();
        //     occlusionRenderBuffer2.clear();
        //     this.#saoDepthLimitedBlurRenderer.render(saoDepthRenderBuffer, occlusionRenderBuffer1, 0);
        //     occlusionRenderBuffer2.unbind();
        //     // Vertically blur occlusion buffer 2 back into occlusion buffer 1
        //     occlusionRenderBuffer1.bind();
        //     occlusionRenderBuffer1.clear();
        //     this.#saoDepthLimitedBlurRenderer.render(saoDepthRenderBuffer, occlusionRenderBuffer2, 1);
        //     occlusionRenderBuffer1.unbind();
        // }
    }

    #drawDepth(params: {
        clear: boolean
    }) {
        this.#renderContext.reset();
        const gl = this.#renderContext.gl;
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.clearColor(0, 0, 0, 0);
        gl.enable(gl.DEPTH_TEST);
        gl.frontFace(gl.CCW);
        gl.enable(gl.CULL_FACE);
        gl.depthMask(true);
        if (params.clear !== false) {
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        }

        // for (let i = 0, len = this.#layerListPostCull.length; i < len; i++) {
        //     const layer = this.#layerListPostCull[i];
        //     // if (layer.culled === true || layer.visible === false || !layer.drawDepth) {
        //     //     continue;
        //     // }
        //     // if (layer.drawFlags.colorOpaque) {
        //     //     //    layer.drawDepth(this.#renderContext);
        //     // }
        // }
        // const numVertexAttribs = WEBGL_INFO.MAX_VERTEX_ATTRIBS; // Fixes https://github.com/xeokit/xeokit-sdk/issues/174
        // for (let ii = 0; ii < numVertexAttribs; ii++) {
        //     gl.disableVertexAttribArray(ii);
        // }
    }

    #drawColor(params: {
        clear: boolean;
    }) {

        const view = this.#view;
        const renderContext = this.#renderContext;
        const gl = renderContext.gl;

        const normalDrawSAOBin: Layer[] = [];
        const edgesColorOpaqueBin: Layer[] = [];
        const normalFillTransparentBin: Layer[] = [];
        const edgesColorTransparentBin: Layer[] = [];
        const xrayedSilhouetteOpaqueBin: Layer[] = [];
        const xrayEdgesOpaqueBin: Layer[] = [];
        const xrayedSilhouetteTransparentBin: Layer[] = [];
        const xrayEdgesTransparentBin: Layer[] = [];
        const highlightedSilhouetteOpaqueBin: Layer[] = [];
        const highlightedEdgesOpaqueBin: Layer[] = [];
        const highlightedSilhouetteTransparentBin: Layer[] = [];
        const highlightedEdgesTransparentBin: Layer[] = [];
        const selectedSilhouetteOpaqueBin: Layer[] = [];
        const selectedEdgesOpaqueBin: Layer[] = [];
        const selectedSilhouetteTransparentBin: Layer[] = [];
        const selectedEdgesTransparentBin: Layer[] = [];

        renderContext.reset();
        renderContext.withSAO = false;
        renderContext.pbrEnabled = this.#pbrEnabled && !!view.qualityRender;

        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

        if (this.#canvasTransparent) {
            gl.clearColor(0, 0, 0, 0);
        } else {
            gl.clearColor(this.#backgroundColor[0], this.#backgroundColor[1], this.#backgroundColor[2], 1.0);
        }

        gl.enable(gl.DEPTH_TEST);
        gl.frontFace(gl.CCW);
        gl.enable(gl.CULL_FACE);
        gl.depthMask(true);
        gl.lineWidth(1);

        renderContext.lineWidth = 1;

        const saoPossible = view.sao.possible;

        if (this.#saoEnabled && saoPossible) {
            // const occlusionRenderBuffer1 = this.#renderBufferManager.getRenderBuffer("saoOcclusion", {
            //     depthTexture: false,
            //     size: [gl.drawingBufferWidth, gl.drawingBufferHeight]
            // });
            // renderContext.occlusionTexture = occlusionRenderBuffer1 ? occlusionRenderBuffer1.getTexture() : null;
        } else {
            renderContext.occlusionTexture = null;

        }

        if (params.clear !== false) {
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        }

        // Render normal opaque solids, defer others to subsequent bins, to render after

        let normalDrawSAOBinLen = 0;
        let edgesColorOpaqueBinLen = 0;
        let normalFillTransparentBinLen = 0;
        let edgesColorTransparentBinLen = 0;
        let xrayedSilhouetteOpaqueBinLen = 0;
        let xrayEdgesOpaqueBinLen = 0;
        let xrayedSilhouetteTransparentBinLen = 0;
        let xrayEdgesTransparentBinLen = 0;
        let highlightedSilhouetteOpaqueBinLen = 0;
        let highlightedEdgesOpaqueBinLen = 0;
        let highlightedSilhouetteTransparentBinLen = 0;
        let highlightedEdgesTransparentBinLen = 0;
        let selectedSilhouetteOpaqueBinLen = 0;
        let selectedEdgesOpaqueBinLen = 0;
        let selectedSilhouetteTransparentBinLen = 0;
        let selectedEdgesTransparentBinLen = 0;

        for (let i = 0, len = this.#layerList.length; i < len; i++) {

            const layer = this.#layerList[i];
            const meshCounts = layer.meshCounts;

            if (meshCounts.numCulled === meshCounts.numMeshes || meshCounts.numVisible === 0) {
                continue;
            }

            if (meshCounts.numTransparent < meshCounts.numMeshes) {
                if (this.#saoEnabled && saoPossible && layer.rendererModel.qualityRender) {
                    normalDrawSAOBin[normalDrawSAOBinLen++] = layer;
                } else {
                    this.#drawLayer(layer, RENDER_PASSES.COLOR_OPAQUE, layer.rendererModel.qualityRender);
                }
            }

            if (this.#transparentEnabled) {
                if (meshCounts.numTransparent) {
                    normalFillTransparentBin[normalFillTransparentBinLen++] = layer;
                }
            }

            if (meshCounts.numXRayed > 0) {
                if (view.xrayMaterial.fill) {
                    if (view.xrayMaterial.fillAlpha < 1.0) {
                        xrayedSilhouetteTransparentBin[xrayedSilhouetteTransparentBinLen++] = layer;
                    } else {
                        xrayedSilhouetteOpaqueBin[xrayedSilhouetteOpaqueBinLen++] = layer;
                    }
                }
            }

            if (meshCounts.numHighlighted > 0) {
                if (view.highlightMaterial.fill) {
                    if (view.highlightMaterial.fillAlpha < 1.0) {
                        highlightedSilhouetteTransparentBin[highlightedSilhouetteTransparentBinLen++] = layer;
                    } else {
                        highlightedSilhouetteOpaqueBin[highlightedSilhouetteOpaqueBinLen++] = layer;
                    }
                }
            }

            if (meshCounts.numSelected > 0) {
                if (view.selectedMaterial.fill) {
                    if (view.selectedMaterial.fillAlpha < 1.0) {
                        selectedSilhouetteTransparentBin[selectedSilhouetteTransparentBinLen++] = layer;
                    } else {
                        selectedSilhouetteOpaqueBin[selectedSilhouetteOpaqueBinLen++] = layer;
                    }
                }
            }

            if (this.#edgesEnabled && this.#view.edgeMaterial.edges) {
                if (meshCounts.numEdges > 0) {
                    if (meshCounts.numTransparent < meshCounts.numMeshes) {
                        edgesColorOpaqueBin[edgesColorOpaqueBinLen++] = layer;
                    }
                    if (meshCounts.numTransparent > 0) {
                        edgesColorTransparentBin[edgesColorTransparentBinLen++] = layer;
                    }
                    if (view.selectedMaterial.edgeAlpha < 1.0) {
                        selectedEdgesTransparentBin[selectedEdgesTransparentBinLen++] = layer;
                    } else {
                        selectedEdgesOpaqueBin[selectedEdgesOpaqueBinLen++] = layer;
                    }
                    if (view.xrayMaterial.edgeAlpha < 1.0) {
                        xrayEdgesTransparentBin[xrayEdgesTransparentBinLen++] = layer;
                    } else {
                        xrayEdgesOpaqueBin[xrayEdgesOpaqueBinLen++] = layer;
                    }
                    if (view.highlightMaterial.edgeAlpha < 1.0) {
                        highlightedEdgesTransparentBin[highlightedEdgesTransparentBinLen++] = layer;
                    } else {
                        highlightedEdgesOpaqueBin[highlightedEdgesOpaqueBinLen++] = layer;
                    }
                }
            }
        }

        // Render deferred bins

        if (normalDrawSAOBinLen > 0) {
            renderContext.withSAO = true;
            for (let i = 0; i < normalDrawSAOBinLen; i++) {
                //    this.#drawLayer(normalDrawSAOBin[i], RENDER_PASSES.COLOR_OPAQUE, layer.rendererModel.qualityRender);
                //    normalDrawSAOBin[i].drawColorOpaque(renderContext);
            }
        }

        for (let i = 0; i < edgesColorOpaqueBinLen; i++) {
            this.#drawLayer(edgesColorOpaqueBin[i], RENDER_PASSES.EDGES_COLOR_OPAQUE);
        }

        for (let i = 0; i < xrayedSilhouetteOpaqueBinLen; i++) {
            this.#drawLayer(xrayedSilhouetteOpaqueBin[i], RENDER_PASSES.SILHOUETTE_XRAYED);
        }

        for (let i = 0; i < xrayEdgesOpaqueBinLen; i++) {
            this.#drawLayer(xrayEdgesOpaqueBin[i], RENDER_PASSES.EDGES_XRAYED);
        }

        if (xrayedSilhouetteTransparentBinLen > 0 || xrayEdgesTransparentBinLen > 0 || normalFillTransparentBinLen > 0 || edgesColorTransparentBinLen > 0) {
            gl.enable(gl.CULL_FACE);
            gl.enable(gl.BLEND);
            if (this.#canvasTransparent) {
                gl.blendEquation(gl.FUNC_ADD);
                gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            } else {
                gl.blendEquation(gl.FUNC_ADD);
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            }
            renderContext.backfaces = false;
            if (!this.#alphaDepthMask) {
                gl.depthMask(false);
            }
            for (let i = 0; i < xrayEdgesTransparentBinLen; i++) {
                this.#drawLayer(xrayEdgesTransparentBin[i], RENDER_PASSES.EDGES_XRAYED);
            }
            for (let i = 0; i < xrayedSilhouetteTransparentBinLen; i++) {
                this.#drawLayer(xrayedSilhouetteTransparentBin[i], RENDER_PASSES.SILHOUETTE_XRAYED);
            }
            if (normalFillTransparentBinLen > 0 || edgesColorTransparentBinLen > 0) {
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            }
            for (let i = 0; i < edgesColorTransparentBinLen; i++) {
                this.#drawLayer(edgesColorTransparentBin[i], RENDER_PASSES.EDGES_COLOR_TRANSPARENT);
            }
            for (let i = 0; i < normalFillTransparentBinLen; i++) {
                this.#drawLayer(normalFillTransparentBin[i], RENDER_PASSES.COLOR_TRANSPARENT);
            }
            gl.disable(gl.BLEND);
            if (!this.#alphaDepthMask) {
                gl.depthMask(true);
            }
        }

        if (highlightedSilhouetteOpaqueBinLen > 0 || highlightedEdgesOpaqueBinLen > 0) {
            renderContext.lastProgramId = -1; // HACK
            gl.clear(gl.DEPTH_BUFFER_BIT);
            for (let i = 0; i < highlightedEdgesOpaqueBinLen; i++) {
                this.#drawLayer(highlightedEdgesOpaqueBin[i], RENDER_PASSES.EDGES_HIGHLIGHTED);
            }
            for (let i = 0; i < highlightedSilhouetteOpaqueBinLen; i++) {
                this.#drawLayer(highlightedSilhouetteOpaqueBin[i], RENDER_PASSES.SILHOUETTE_HIGHLIGHTED);
            }
        }

        if (highlightedSilhouetteTransparentBinLen > 0 || highlightedEdgesTransparentBinLen > 0 || highlightedSilhouetteOpaqueBinLen > 0) {
            renderContext.lastProgramId = -1;
            gl.clear(gl.DEPTH_BUFFER_BIT);
            gl.enable(gl.CULL_FACE);
            gl.enable(gl.BLEND);
            if (this.#canvasTransparent) {
                gl.blendEquation(gl.FUNC_ADD);
                gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            } else {
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            }
            for (let i = 0; i < highlightedEdgesTransparentBinLen; i++) {
                this.#drawLayer(highlightedEdgesTransparentBin[i], RENDER_PASSES.EDGES_HIGHLIGHTED);
            }
            for (let i = 0; i < highlightedSilhouetteTransparentBinLen; i++) {
                this.#drawLayer(highlightedSilhouetteTransparentBin[i], RENDER_PASSES.SILHOUETTE_HIGHLIGHTED);
            }
            gl.disable(gl.BLEND);
        }

        if (selectedSilhouetteOpaqueBinLen > 0 || selectedEdgesOpaqueBinLen > 0) {
            renderContext.lastProgramId = -1;
            gl.clear(gl.DEPTH_BUFFER_BIT);
            for (let i = 0; i < selectedEdgesOpaqueBinLen; i++) {
                this.#drawLayer(selectedEdgesOpaqueBin[i], RENDER_PASSES.EDGES_SELECTED);
            }
            for (let i = 0; i < selectedSilhouetteOpaqueBinLen; i++) {
                this.#drawLayer(selectedSilhouetteOpaqueBin[i], RENDER_PASSES.SILHOUETTE_SELECTED);
            }
        }

        if (selectedSilhouetteTransparentBinLen > 0 || selectedEdgesTransparentBinLen > 0) {
            renderContext.lastProgramId = -1;
            gl.clear(gl.DEPTH_BUFFER_BIT);
            gl.enable(gl.CULL_FACE);
            gl.enable(gl.BLEND);
            if (this.#canvasTransparent) {
                gl.blendEquation(gl.FUNC_ADD);
                gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            } else {
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            }
            for (let i = 0; i < selectedEdgesTransparentBinLen; i++) {
                this.#drawLayer(selectedEdgesTransparentBin[i], RENDER_PASSES.EDGES_SELECTED);
            }
            for (let i = 0; i < selectedSilhouetteTransparentBinLen; i++) {
                this.#drawLayer(selectedSilhouetteTransparentBin[i], RENDER_PASSES.SILHOUETTE_SELECTED);
            }
            gl.disable(gl.BLEND);
        }

        const numTextureUnits = WEBGL_INFO.MAX_TEXTURE_UNITS;
        for (let ii = 0; ii < numTextureUnits; ii++) {
            gl.activeTexture(gl.TEXTURE0 + ii);
        }
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
        gl.bindTexture(gl.TEXTURE_2D, null);

        const numVertexAttribs = WEBGL_INFO.MAX_VERTEX_ATTRIBS; // Fixes https://github.com/xeokit/xeokit-sdk/issues/174
        for (let ii = 0; ii < numVertexAttribs; ii++) {
            gl.disableVertexAttribArray(ii);
        }
    }

    #drawLayer(layer: Layer, renderPass: number, quality: boolean = true) {
        switch (layer.renderState.primitive) {
            case TrianglesPrimitive:
            case SurfacePrimitive:
            case SolidPrimitive:
                switch (renderPass) {
                    case RENDER_PASSES.COLOR_OPAQUE:
                        if (layer.meshCounts.numTransparent === layer.meshCounts.numMeshes || layer.meshCounts.numXRayed === layer.meshCounts.numMeshes) {
                            return;
                        }
                        if (quality) {
                            //    this.#layerRenderers.qualityColorTriangles.draw(layer);
                        } else {
                            this.#layerRenderers.colorTriangles.draw(layer);
                        }
                        break;
                    case RENDER_PASSES.COLOR_TRANSPARENT:
                        if (layer.meshCounts.numTransparent === 0) {
                            return;
                        }
                        if (quality) {
                            //     this.#layerRenderers.qualityColorTriangles.draw(layer);
                        } else {
                            this.#layerRenderers.colorTriangles.draw(layer);
                        }
                        break;
                    case RENDER_PASSES.SILHOUETTE_SELECTED:
                        if (layer.meshCounts.numSelected > 0) {
                            //  this.#layerRenderers.silhouetteTriangles.draw(layer);
                        }
                        break;
                    case RENDER_PASSES.SILHOUETTE_HIGHLIGHTED:
                        if (layer.meshCounts.numHighlighted > 0) {
                            // this.#layerRenderers.silhouetteTriangles.draw(layer);
                        }
                        break;
                    case RENDER_PASSES.SILHOUETTE_XRAYED:
                        if (layer.meshCounts.numXRayed > 0) {
                            //   this.#layerRenderers.silhouetteTriangles.draw(layer);
                        }
                        break;
                }
                break;
            case LinesPrimitive:
                switch (renderPass) {
                    case RENDER_PASSES.COLOR_OPAQUE:
                    case RENDER_PASSES.COLOR_TRANSPARENT:
                        //this.#layerRenderers.colorLines.draw(layer);
                        break;
                    case RENDER_PASSES.SILHOUETTE_SELECTED:
                    case RENDER_PASSES.SILHOUETTE_HIGHLIGHTED:
                    case RENDER_PASSES.SILHOUETTE_XRAYED:
                        // this.#layerRenderers.silhouetteLines.draw(layer);
                        break;
                }
                break;
            case PointsPrimitive:
                switch (renderPass) {
                    case RENDER_PASSES.COLOR_OPAQUE:
                    case RENDER_PASSES.COLOR_TRANSPARENT:
                        //  this.#layerRenderers.colorPoints.draw(layer);
                        break;
                    case RENDER_PASSES.SILHOUETTE_SELECTED:
                    case RENDER_PASSES.SILHOUETTE_HIGHLIGHTED:
                    case RENDER_PASSES.SILHOUETTE_XRAYED:
                        //  this.#layerRenderers.silhouettePoints.draw(layer);
                        break;
                }
                break;
        }
    }


}