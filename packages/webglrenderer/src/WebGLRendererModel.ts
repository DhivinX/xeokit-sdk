import {EventDispatcher} from "strongly-typed-events";
import {Component, EventEmitter, SDKError, type TextureTranscoder} from "@xeokit/core";
import {createUUID, loadArraybuffer} from "@xeokit/utils";
import {collapseAABB3, expandAABB3} from "@xeokit/boundaries";
import {composeMat4, createMat4, createVec3, createVec4, eulerToQuat, identityQuat, mulMat4} from "@xeokit/matrix";

import type {FloatArrayParam} from "@xeokit/math";
import type {Camera, RendererViewObject, View, Viewer} from "@xeokit/viewer";
import {GLTexture} from "@xeokit/webglutils";
import type {
    Geometry,
    GeometryCompressedParams,
    Mesh,
    RendererGeometry,
    RendererMesh,
    RendererModel,
    RendererTexture,
    RendererTextureSet,
    SceneModel,
    SceneObject,
    Texture,
    TextureSet
} from "@xeokit/scene";
import type {WebGLRenderer} from "./WebGLRenderer";
import {Layer} from "./Layer";
import type {RenderContext} from "./RenderContext";
import {WebGLRendererGeometry} from "./WebGLRendererGeometry";

import {WebGLRendererTexture} from "./WebGLRendererTexture";
import {WebGLRendererObject} from "./WebGLRendererObject";
import {WebGLRendererMesh} from "./WebGLRendererMesh";
import {WebGLRendererTextureSet} from "./WebGLRendererTextureSet";
import type {LayerParams} from "./LayerParams";
import type {WebGLTileManager} from "./WebGLTileManager";


const tempVec3a = createVec3();
const tempMat4 = createMat4();

const defaultScale = createVec3([1, 1, 1]);
const defaultPosition = createVec3([0, 0, 0]);
const defaultRotation = createVec3([0, 0, 0]);
const defaultQuaternion = identityQuat();

const defaultColorTextureId = "defaultColorTexture";
const defaultMetalRoughTextureId = "defaultMetalRoughTexture";
const defaultNormalsTextureId = "defaultNormalsTexture";
const defaultEmissiveTextureId = "defaultEmissiveTexture";
const defaultOcclusionTextureId = "defaultOcclusionTexture";
const defaultTextureSetId = "defaultTextureSet";

/**
 * TODO
 * @internal
 */
export class WebGLRendererModel extends Component implements RendererModel {

    readonly qualityRender: boolean;
    declare readonly id: string;
    declare readonly destroyed: boolean;
    declare built: boolean;

    sceneModel: SceneModel | null;

    rendererGeometries: { [key: string]: RendererGeometry };
    rendererTextures: { [key: string]: RendererTexture };
    rendererTextureSets: { [key: string]: RendererTextureSet; };
    rendererMeshes: { [key: string]: RendererMesh };
    rendererObjects: { [key: string]: WebGLRendererObject };
    rendererObjectsList: WebGLRendererObject[];

    rendererViewObjects: { [key: string]: RendererViewObject };

    readonly viewer: Viewer;

    layerList: Layer[];
    readonly onBuilt: EventEmitter<RendererModel, null>;
    declare readonly onDestroyed: EventEmitter<Component, null>;
    #view: View;
    #webglRenderer: WebGLRenderer;
    #renderContext: RenderContext;
    #position: FloatArrayParam;
    #rotation: FloatArrayParam;
    #quaternion: FloatArrayParam;
    #scale: FloatArrayParam;
    #worldMatrix: FloatArrayParam;
    #viewMatrix: FloatArrayParam;
    #colorTextureEnabled: boolean;
    #backfaces: boolean;
    #layers: { [key: string]: Layer };
    #numGeometries: number;
    #numTriangles: number;
    #numLines: number;
    #numPoints: number;
    #numRendererObjects: number;
    #textureTranscoder: TextureTranscoder;
    #aabbDirty: boolean;
    #edgeThreshold: number;
    #currentLayers: { [key: string]: any };
    #aabb: FloatArrayParam;
    #viewMatrixDirty: boolean;
    #worldMatrixNonIdentity: boolean;
    #onCameraViewMatrix: () => void;
    #layerId: string | undefined;

    constructor(params: {
        id: string;
        sceneModel: SceneModel;
        matrix?: FloatArrayParam;
        scale?: FloatArrayParam;
        view: View;
        webglRenderer: WebGLRenderer;
        renderContext: RenderContext;
        quaternion?: FloatArrayParam;
        rotation?: FloatArrayParam;
        position?: FloatArrayParam;
        edgeThreshold?: number;
        textureTranscoder: TextureTranscoder;
        qualityRender?: boolean;
        layerId?: string;
    }) {

        super(params.view);

        this.id = params.id;
        this.sceneModel = params.sceneModel
        this.viewer = params.view.viewer;

        this.#view = params.view;
        this.#webglRenderer = params.webglRenderer;
        this.#renderContext = params.renderContext;
        this.#textureTranscoder = params.textureTranscoder;

        this.#aabb = collapseAABB3();
        this.#aabbDirty = false;
        this.#layers = {};
        this.layerList = [];
        this.#currentLayers = {};

        this.rendererGeometries = {};
        this.rendererTextures = {};
        this.rendererTextureSets = {};
        this.rendererMeshes = {};
        this.rendererObjects = {};
        this.rendererObjectsList = [];

        this.rendererViewObjects = {};

        this.#numGeometries = 0;
        this.#numRendererObjects = 0;

        this.#numTriangles = 0;
        this.#numLines = 0;
        this.#numPoints = 0;
        this.#edgeThreshold = params.edgeThreshold || 10;

        this.built = false;

        // Build static matrix

        this.#position = createVec3(params.position || [0, 0, 0]);
        this.#rotation = createVec3(params.rotation || [0, 0, 0]);
        this.#quaternion = createVec4(params.quaternion || [0, 0, 0, 1]);
        if (params.rotation) {
            eulerToQuat(this.#rotation, "XYZ", this.#quaternion);
        }
        this.#scale = createVec3(params.scale || [1, 1, 1]);
        this.#worldMatrix = createMat4();
        composeMat4(this.#position, this.#quaternion, this.#scale, this.#worldMatrix);

        if (params.matrix || params.position || params.rotation || params.scale || params.quaternion) {
            this.#viewMatrix = createMat4();
            this.#viewMatrixDirty = true;
            this.#worldMatrixNonIdentity = true;
        }

        this.qualityRender = (params.qualityRender !== false);

        this.#layerId = params.layerId;

        this.#onCameraViewMatrix = this.#view.camera.onViewMatrix.subscribe((camera: Camera, viewMatrix: FloatArrayParam) => {
            this.#viewMatrixDirty = true;
        });

        this.#createDefaultTextureSet();

        this.onBuilt = new EventEmitter(new EventDispatcher<RendererModel, null>());

        this.#attachSceneModel(params.sceneModel);

        // this.layerList.sort((a, b) => {
        //     if (a.sortId < b.sortId) {
        //         return -1;
        //     }
        //     if (a.sortId > b.sortId) {
        //         return 1;
        //     }
        //     return 0;
        // });
        for (let i = 0, len = this.layerList.length; i < len; i++) {
            const layer = this.layerList[i];
            layer.layerIndex = i;
        }
        this.#currentLayers = {};
        this.built = true;
        this.#webglRenderer.setImageDirty();
        //     this.#view.viewer.scene.setAABBDirty();
        this.onBuilt.dispatch(this, null);
    }

    #attachSceneModel(sceneModel: SceneModel): void {
        const textures = sceneModel.textures;
        const geometries = sceneModel.geometries;
        const meshes = sceneModel.meshes;
        const objects = sceneModel.objects;
        if (textures) {
            for (let textureId in textures) {
                this.#attachTexture(textures[textureId]);
            }
        }
        if (geometries) {
            for (let geometryId in geometries) {
                this.#attachGeometry(geometries[geometryId]);
            }
        }
        if (meshes) {
            for (let meshId in meshes) {
                this.#attachMesh(meshes[meshId]);
            }
        }
        if (objects) {
            for (let objectId in objects) {
                this.#attachSceneObject(objects[objectId]);
            }
        }
        for (let layerId in this.#currentLayers) {
            this.#currentLayers[layerId].build();
        }
        for (let i = 0, len = this.rendererObjectsList.length; i < len; i++) {
            this.rendererObjectsList[i].build();
        }
        for (let i = 0, len = this.rendererObjectsList.length; i < len; i++) {
            this.rendererObjectsList[i].build2();
        }
    }

    #attachTexture(texture: Texture): void {
        const textureId = texture.id;
        if (this.rendererTextures[textureId]) {
            throw new SDKError("RendererTexture already created: " + textureId);
        }
        const glTexture = new GLTexture({gl: this.#renderContext.gl});
        if (texture.preloadColor) {
            glTexture.setPreloadColor(texture.preloadColor);
        }
        if (texture.image) { // Ignore transcoder for Images
            const image = texture.image;
            image.crossOrigin = "Anonymous";
            glTexture.setImage(image, {
                minFilter: texture.minFilter,
                magFilter: texture.magFilter,
                wrapS: texture.wrapS,
                wrapT: texture.wrapT,
                wrapR: texture.wrapR,
                flipY: texture.flipY,
                encoding: texture.encoding
            });
        } else if (texture.src) {
            const ext = texture.src.split('.').pop();
            switch (ext) { // Don't transcode recognized image file types
                case "jpeg":
                case "jpg":
                case "png":
                case "gif":
                    const image = new Image();
                    image.onload = () => {
                        glTexture.setImage(image, {
                            minFilter: texture.minFilter,
                            magFilter: texture.magFilter,
                            wrapS: texture.wrapS,
                            wrapT: texture.wrapT,
                            wrapR: texture.wrapR,
                            flipY: texture.flipY,
                            encoding: texture.encoding
                        });
                    };
                    image.src = texture.src; // URL or Base64 string
                    break;
                default: // Assume other file types need transcoding
                    if (!this.#textureTranscoder) {
                        this.error(`Can't create texture from 'src' - rendererModel needs to be configured with a TextureTranscoder for this file type ('${ext}')`);
                    } else {
                        loadArraybuffer(texture.src, (arrayBuffer: ArrayBuffer) => {
                                if (!arrayBuffer.byteLength) {
                                    this.error(`Can't create texture from 'src': file data is zero length`);
                                    return;
                                }
                                this.#textureTranscoder.transcode([arrayBuffer]).then((compressedTextureData) => {
                                    glTexture.setCompressedData(compressedTextureData);
                                    this.#webglRenderer.setImageDirty();
                                });
                            },
                            (errMsg: string) => {
                                this.error(`Can't create texture from 'src': ${errMsg}`);
                            });
                    }
                    break;
            }
        } else if (texture.buffers) { // Buffers implicitly require transcoding
            if (!this.#textureTranscoder) {
                this.error(`Can't create texture from 'buffers' - rendererModel needs to be configured with a TextureTranscoder for this option`);
            } else {
                this.#textureTranscoder.transcode(texture.buffers).then((compressedTextureData) => {
                    glTexture.setCompressedData(compressedTextureData);
                    this.#webglRenderer.setImageDirty();
                });
            }
        }
        const rendererTexture = new WebGLRendererTexture(texture, glTexture);
        texture.rendererTexture = rendererTexture;
        this.rendererTextures[textureId] = rendererTexture;
    }

    #attachGeometry(geometry: Geometry): void {
        const geometryId = geometry.id;
        if (this.rendererGeometries[geometryId]) {
            throw new SDKError(`RendererGeometry already created: ${geometryId}`);
        }
        const rendererGeometry = new WebGLRendererGeometry();
        this.rendererGeometries[geometryId] = rendererGeometry;
        geometry.rendererGeometry = rendererGeometry;
        this.#numGeometries++;
    }

    #attachMesh(mesh: Mesh): void {
        const rendererGeometry = this.rendererGeometries[mesh.geometry.id];
        if (!rendererGeometry) {
            throw new SDKError("RendererGeometry not found");
        }
        const textureSetId = mesh.textureSet ? (<TextureSet>mesh.textureSet).id : defaultTextureSetId;
        const rendererTextureSet = this.rendererTextureSets[textureSetId];
        if (!rendererTextureSet) {
            throw new SDKError("TextureSet not found");
        }
        const layer = this.#getLayer(textureSetId, mesh.geometry);
        if (!layer) {
            return;
        }
        if (!layer.hasGeometry(mesh.geometry.id)) {
            layer.createGeometryCompressed(mesh.geometry)
        }
        let meshMatrix;
        let worldMatrix = this.#worldMatrixNonIdentity ? this.#worldMatrix : null;
        meshMatrix = mesh.matrix;
        const color = (mesh.color) ? new Uint8Array([Math.floor(mesh.color[0] * 255), Math.floor(mesh.color[1] * 255), Math.floor(mesh.color[2] * 255)]) : [255, 255, 255];
        const opacity = (mesh.opacity !== undefined && mesh.opacity !== null) ? Math.floor(mesh.opacity * 255) : 255;
        const metallic = (mesh.metallic !== undefined && mesh.metallic !== null) ? Math.floor(mesh.metallic * 255) : 0;
        const roughness = (mesh.roughness !== undefined && mesh.roughness !== null) ? Math.floor(mesh.roughness * 255) : 255;
        const meshRenderer = new WebGLRendererMesh({
            tileManager: <WebGLTileManager>this.#webglRenderer.tileManager,
            id: mesh.id,
            layer,
            color,
            opacity,
            matrix: meshMatrix,
            metallic,
            roughness,
            rendererTextureSet,
            rendererGeometry,
            meshIndex: 0
        });
        meshRenderer.pickId = this.#webglRenderer.attachPickable(meshRenderer);
        const a = meshRenderer.pickId >> 24 & 0xFF;
        const b = meshRenderer.pickId >> 16 & 0xFF;
        const g = meshRenderer.pickId >> 8 & 0xFF;
        const r = meshRenderer.pickId & 0xFF;
        const pickColor = new Uint8Array([r, g, b, a]); // Quantized pick color
        collapseAABB3(meshRenderer.aabb);
        const meshIndex = layer.createMesh({
            id: mesh.id,
            geometryId: mesh.geometry.id,
            color,
            opacity,
            metallic,
            roughness,
            matrix: meshMatrix,
            //     worldMatrix: worldMatrix,
            //    aabb: mesh.aabb,
            pickColor
        });
        this.#numGeometries++;
        expandAABB3(this.#aabb, meshRenderer.aabb);
        meshRenderer.layer = layer;
        meshRenderer.meshIndex = meshIndex;
        this.rendererMeshes[mesh.id] = meshRenderer;
    }

    #getLayer(textureSetId: string, geometryCompressedParams: GeometryCompressedParams): Layer | undefined {
        const layerId = `${textureSetId}_${geometryCompressedParams.primitive}`;
        let layer = this.#currentLayers[layerId];
        if (layer) {
            if (layer.canCreateMesh(geometryCompressedParams)) {
                return layer;
            } else {
                layer.build();
                delete this.#currentLayers[layerId];
            }
        }
        let textureSet;
        if (textureSetId) {
            textureSet = this.rendererTextureSets[textureSetId];
            if (!textureSet) {
                this.error(`TextureSet not found: ${textureSetId} - ensure that you create it first with createTextureSet()`);
                return;
            }
        }
        layer = new Layer(<LayerParams>{
            gl: this.#renderContext.gl,
            view: this.#view,
            rendererModel: this,
            primitive: geometryCompressedParams.primitive,
            textureSet,
            layerIndex: 0
        });
        this.#layers[layerId] = layer;
        this.layerList.push(layer);
        this.#currentLayers[layerId] = layer;
        return layer;
    }

    #attachSceneObject(sceneObject: SceneObject): void {
        let objectId = sceneObject.id;
        if (objectId === undefined) {
            objectId = createUUID();
        } else if (this.rendererObjects[objectId]) {
            this.error("[createObject] rendererModel already has a ViewerObject with this ID: " + objectId + " - will assign random ID");
            objectId = createUUID();
        }
        const meshes = sceneObject.meshes;
        if (meshes === undefined) {
            throw new SDKError("[createObject] Param expected: meshes");
        }
        const rendererMeshes: WebGLRendererMesh[] = [];
        for (let i = 0, len = meshes.length; i < len; i++) {
            const mesh = meshes[i];
            const rendererMesh = <WebGLRendererMesh>this.rendererMeshes[mesh.id];
            rendererMeshes.push(rendererMesh);
        }
        const rendererObject = new WebGLRendererObject({
            id: objectId,
            sceneObject,
            rendererModel: this,
            rendererMeshes,
            aabb: sceneObject.aabb,
            layerId: this.#layerId
        });
        this.rendererObjectsList.push(rendererObject);
        this.rendererObjects[objectId] = rendererObject; // <RendererObject>
        this.rendererViewObjects[objectId] = rendererObject; // <RendererViewObject>
        this.#numRendererObjects++;
    }

    get position(): FloatArrayParam {
        return this.#position;
    }

    get rotation(): FloatArrayParam {
        return this.#rotation;
    }

    get quaternion(): FloatArrayParam {
        return this.#quaternion;
    }

    get scale(): FloatArrayParam {
        return this.#scale;
    }

    get worldMatrix(): FloatArrayParam {
        return this.#worldMatrix;
    }

    get viewMatrix(): FloatArrayParam {
        if (!this.#viewMatrix) {
            return this.#view.camera.viewMatrix;
        }
        if (this.#viewMatrixDirty) {
            mulMat4(this.#view.camera.viewMatrix, this.#worldMatrix, this.#viewMatrix);
            this.#viewMatrixDirty = false;
        }
        return this.#viewMatrix;
    }

    get colorTextureEnabled() {
        return this.#colorTextureEnabled;
    }

    get backfaces(): boolean {
        return this.#backfaces;
    }

    set backfaces(backfaces: boolean) {
        backfaces = !!backfaces;
        this.#backfaces = backfaces;
        this.#webglRenderer.setImageDirty();
    }

    get matrix(): FloatArrayParam {
        return this.#worldMatrix;
    }

    get aabb(): FloatArrayParam {
        if (this.#aabbDirty) {
            this.#rebuildAABB();
        }
        return this.#aabb;
    }

    get numTriangles(): number {
        return this.#numTriangles;
    }

    get numLines(): number {
        return this.#numLines;
    }

    get numPoints(): number {
        return this.#numPoints;
    }

    setVisible(viewIndex: number, visible: boolean): void {
        for (let i = 0, len = this.rendererObjectsList.length; i < len; i++) {
            this.rendererObjectsList[i].setVisible(viewIndex, visible);
        }
        this.#webglRenderer.setImageDirty(viewIndex);
    }

    setXRayed(viewIndex: number, xrayed: boolean): void {
        for (let i = 0, len = this.rendererObjectsList.length; i < len; i++) {
            this.rendererObjectsList[i].setXRayed(viewIndex, xrayed);
        }
        this.#webglRenderer.setImageDirty(viewIndex);
    }

    setHighlighted(viewIndex: number, highlighted: boolean): void {
        for (let i = 0, len = this.rendererObjectsList.length; i < len; i++) {
            this.rendererObjectsList[i].setHighlighted(viewIndex, highlighted);
        }
        this.#webglRenderer.setImageDirty(viewIndex);
    }

    setSelected(viewIndex: number, selected: boolean): void {
        for (let i = 0, len = this.rendererObjectsList.length; i < len; i++) {
            this.rendererObjectsList[i].setSelected(viewIndex, selected);
        }
        this.#webglRenderer.setImageDirty(viewIndex);
    }

    setEdges(viewIndex: number, edges: boolean): void {
        for (let i = 0, len = this.rendererObjectsList.length; i < len; i++) {
            this.rendererObjectsList[i].setEdges(viewIndex, edges);
        }
        this.#webglRenderer.setImageDirty(viewIndex);
    }

    setCulled(viewIndex: number, culled: boolean): void {
        for (let i = 0, len = this.rendererObjectsList.length; i < len; i++) {
            this.rendererObjectsList[i].setCulled(viewIndex, culled);
        }
        this.#webglRenderer.setImageDirty(viewIndex);
    }

    setClippable(viewIndex: number, clippable: boolean): void {
        for (let i = 0, len = this.rendererObjectsList.length; i < len; i++) {
            this.rendererObjectsList[i].setClippable(viewIndex, clippable);
        }
        this.#webglRenderer.setImageDirty(viewIndex);
    }

    setCollidable(viewIndex: number, collidable: boolean): void {
        for (let i = 0, len = this.rendererObjectsList.length; i < len; i++) {
            this.rendererObjectsList[i].setCollidable(viewIndex, collidable);
        }
    }

    setPickable(viewIndex: number, pickable: boolean): void {
        for (let i = 0, len = this.rendererObjectsList.length; i < len; i++) {
            this.rendererObjectsList[i].setPickable(viewIndex, pickable);
        }
    }

    setColorize(viewIndex: number, colorize: FloatArrayParam): void {
        for (let i = 0, len = this.rendererObjectsList.length; i < len; i++) {
            this.rendererObjectsList[i].setColorize(viewIndex, colorize);
        }
    }

    setOpacity(viewIndex: number, opacity: number): void {
        for (let i = 0, len = this.rendererObjectsList.length; i < len; i++) {
            this.rendererObjectsList[i].setOpacity(viewIndex, opacity);
        }
    }

    /*
    rebuildDrawFlags() {
        this.drawFlags.reset();
        this.#updateDrawFlagsVisibleLayers();
        if (this.drawFlags.numLayers > 0 && this.drawFlags.numVisibleLayers === 0) {
            this.drawFlags.culled = true;
            return;
        }
        this.#updateDrawFlags();
    }

    drawColorOpaque(renderContext: RenderContext): void {
        if (this.meshCounts.numVisible === 0) {
            return;
        }
        const drawFlags = this.drawFlags;
        for (let i = 0, len = drawFlags.visibleLayers.length; i < len; i++) {
            const layerIndex = drawFlags.visibleLayers[i];
            this.layerList[layerIndex].drawColorOpaque(drawFlags, renderContext);
        }
    }

    drawColorTransparent(renderContext: RenderContext): void {
        if (this.meshCounts.numVisible === 0) {
            return;
        }
        const drawFlags = this.drawFlags;
        for (let i = 0, len = drawFlags.visibleLayers.length; i < len; i++) {
            const layerIndex = drawFlags.visibleLayers[i];
            this.layerList[layerIndex].drawColorTransparent(drawFlags, renderContext);
        }
    }

    drawDepth(renderContext: RenderContext): void { // Dedicated to SAO because it skips transparent objects
        if (this.meshCounts.numVisible === 0) {
            return;
        }
        const drawFlags = this.drawFlags;
        for (let i = 0, len = drawFlags.visibleLayers.length; i < len; i++) {
            const layerIndex = drawFlags.visibleLayers[i];
            this.layerList[layerIndex].drawDepth(drawFlags, renderContext);
        }
    }

    drawNormals(renderContext: RenderContext): void { // Dedicated to SAO because it skips transparent objects
        if (this.meshCounts.numVisible === 0) {
            return;
        }
        const drawFlags = this.drawFlags;
        for (let i = 0, len = drawFlags.visibleLayers.length; i < len; i++) {
            const layerIndex = drawFlags.visibleLayers[i];
            this.layerList[layerIndex].drawNormals(drawFlags, renderContext);
        }
    }

    drawSilhouetteXRayed(renderContext: RenderContext): void {
        if (this.meshCounts.numVisible === 0) {
            return;
        }
        const drawFlags = this.drawFlags;
        for (let i = 0, len = drawFlags.visibleLayers.length; i < len; i++) {
            const layerIndex = drawFlags.visibleLayers[i];
            this.layerList[layerIndex].drawSilhouetteXRayed(drawFlags, renderContext);
        }
    }

    drawSilhouetteHighlighted(renderContext: RenderContext): void {
        if (this.meshCounts.numVisible === 0) {
            return;
        }
        const drawFlags = this.drawFlags;
        for (let i = 0, len = drawFlags.visibleLayers.length; i < len; i++) {
            const layerIndex = drawFlags.visibleLayers[i];
            this.layerList[layerIndex].drawSilhouetteHighlighted(drawFlags, renderContext);
        }
    }

    drawSilhouetteSelected(renderContext: RenderContext): void {
        if (this.meshCounts.numVisible === 0) {
            return;
        }
        const drawFlags = this.drawFlags;
        for (let i = 0, len = drawFlags.visibleLayers.length; i < len; i++) {
            const layerIndex = drawFlags.visibleLayers[i];
            this.layerList[layerIndex].drawSilhouetteSelected(drawFlags, renderContext);
        }
    }

    drawEdgesColorOpaque(renderContext: RenderContext): void {
        if (this.meshCounts.numVisible === 0) {
            return;
        }
        const drawFlags = this.drawFlags;
        for (let i = 0, len = drawFlags.visibleLayers.length; i < len; i++) {
            const layerIndex = drawFlags.visibleLayers[i];
            this.layerList[layerIndex].drawEdgesColorOpaque(drawFlags, renderContext);
        }
    }

    drawEdgesColorTransparent(renderContext: RenderContext): void {
        if (this.meshCounts.numVisible === 0) {
            return;
        }
        const drawFlags = this.drawFlags;
        for (let i = 0, len = drawFlags.visibleLayers.length; i < len; i++) {
            const layerIndex = drawFlags.visibleLayers[i];
            this.layerList[layerIndex].drawEdgesColorTransparent(drawFlags, renderContext);
        }
    }

    drawEdgesXRayed(renderContext: RenderContext): void {
        if (this.meshCounts.numVisible === 0) {
            return;
        }
        const drawFlags = this.drawFlags;
        for (let i = 0, len = drawFlags.visibleLayers.length; i < len; i++) {
            const layerIndex = drawFlags.visibleLayers[i];
            this.layerList[layerIndex].drawEdgesXRayed(drawFlags, renderContext);
        }
    }

    drawEdgesHighlighted(renderContext: RenderContext) {
        if (this.meshCounts.numVisible === 0) {
            return;
        }
        const drawFlags = this.drawFlags;
        for (let i = 0, len = drawFlags.visibleLayers.length; i < len; i++) {
            const layerIndex = drawFlags.visibleLayers[i];
            this.layerList[layerIndex].drawEdgesHighlighted(drawFlags, renderContext);
        }
    }

    drawEdgesSelected(renderContext: RenderContext) {
        if (this.meshCounts.numVisible === 0) {
            return;
        }
        const drawFlags = this.drawFlags;
        for (let i = 0, len = drawFlags.visibleLayers.length; i < len; i++) {
            const layerIndex = drawFlags.visibleLayers[i];
            this.layerList[layerIndex].drawEdgesSelected(drawFlags, renderContext);
        }
    }

    drawOcclusion(renderContext: RenderContext) {
        if (this.meshCounts.numVisible === 0) {
            return;
        }
        const drawFlags = this.drawFlags;
        for (let i = 0, len = drawFlags.visibleLayers.length; i < len; i++) {
            const layerIndex = drawFlags.visibleLayers[i];
            this.layerList[layerIndex].drawOcclusion(drawFlags, renderContext);
        }
    }

    drawShadow(renderContext: RenderContext) {
        if (this.meshCounts.numVisible === 0) {
            return;
        }
        const drawFlags = this.drawFlags;
        for (let i = 0, len = drawFlags.visibleLayers.length; i < len; i++) {
            const layerIndex = drawFlags.visibleLayers[i];
            this.layerList[layerIndex].drawShadow(drawFlags, renderContext);
        }
    }

    drawPickMesh(renderContext: RenderContext) {
        if (this.meshCounts.numVisible === 0) {
            return;
        }
        const drawFlags = this.drawFlags;
        for (let i = 0, len = drawFlags.visibleLayers.length; i < len; i++) {
            const layerIndex = drawFlags.visibleLayers[i];
            this.layerList[layerIndex].drawPickMesh(drawFlags, renderContext);
        }
    }

    drawPickDepths(renderContext: RenderContext) {
        if (this.meshCounts.numVisible === 0) {
            return;
        }
        const drawFlags = this.drawFlags;
        for (let i = 0, len = drawFlags.visibleLayers.length; i < len; i++) {
            const layerIndex = drawFlags.visibleLayers[i];
            this.layerList[layerIndex].drawPickDepths(drawFlags, renderContext);
        }
    }

    drawPickNormals(renderContext: RenderContext) {
        if (this.meshCounts.numVisible === 0) {
            return;
        }
        const drawFlags = this.drawFlags;
        for (let i = 0, len = drawFlags.visibleLayers.length; i < len; i++) {
            const layerIndex = drawFlags.visibleLayers[i];
            this.layerList[layerIndex].drawPickNormals(drawFlags, renderContext);
        }
    }
*/

    #createDefaultTextureSet() {
        const defaultColorRendererTexture = new WebGLRendererTexture(
            null,
            new GLTexture({
                gl: this.#renderContext.gl,
                preloadColor: [1, 1, 1, 1] // [r, g, b, a]})
            }));

        const defaultMetalRoughRendererTexture = new WebGLRendererTexture(
            null,
            new GLTexture({
                gl: this.#renderContext.gl,
                preloadColor: [0, 1, 1, 1] // [unused, roughness, metalness, unused]
            }));
        const defaultNormalsRendererTexture = new WebGLRendererTexture(
            null,
            new GLTexture({
                gl: this.#renderContext.gl,
                preloadColor: [0, 0, 0, 0] // [x, y, z, unused] - these must be zeros
            }));

        const defaultEmissiveRendererTexture = new WebGLRendererTexture(
            null,
            new GLTexture({
                gl: this.#renderContext.gl,
                preloadColor: [0, 0, 0, 1] // [x, y, z, unused]
            }));
        const defaultOcclusionRendererTexture = new WebGLRendererTexture(
            null,
            new GLTexture({
                gl: this.#renderContext.gl,
                preloadColor: [1, 1, 1, 1] // [x, y, z, unused]
            }));
        this.rendererTextures[defaultColorTextureId] = defaultColorRendererTexture;
        this.rendererTextures[defaultMetalRoughTextureId] = defaultMetalRoughRendererTexture;
        this.rendererTextures[defaultNormalsTextureId] = defaultNormalsRendererTexture;
        this.rendererTextures[defaultEmissiveTextureId] = defaultEmissiveRendererTexture;
        this.rendererTextures[defaultOcclusionTextureId] = defaultOcclusionRendererTexture;
        this.rendererTextureSets[defaultTextureSetId] = new WebGLRendererTextureSet({
            id: defaultTextureSetId,
            colorRendererTexture: defaultColorRendererTexture,
            metallicRoughnessRendererTexture: defaultMetalRoughRendererTexture,
            emissiveRendererTexture: defaultEmissiveRendererTexture,
            occlusionRendererTexture: defaultOcclusionRendererTexture
        });
    }

    #rebuildAABB() {
        collapseAABB3(this.#aabb);
        for (let i = 0, len = this.rendererObjectsList.length; i < len; i++) {
            const rendererObject = this.rendererObjectsList[i];
            expandAABB3(this.#aabb, rendererObject.aabb);
        }
        this.#aabbDirty = false;
    }

    /*
        #getActiveSectionPlanesForLayer(layer: any) {
            const drawFlags = this.drawFlags;
            const sectionPlanes = this.#view.sectionPlanesList;
            const numSectionPlanes = sectionPlanes.length;
            const baseIndex = layer.layerIndex * numSectionPlanes;
            if (numSectionPlanes > 0) {
                for (let i = 0; i < numSectionPlanes; i++) {
                    const sectionPlane = sectionPlanes[i];
                    if (!sectionPlane.active) {
                        drawFlags.sectionPlanesActivePerLayer[baseIndex + i] = false;

                    } else {
                        drawFlags.sectionPlanesActivePerLayer[baseIndex + i] = true;
                        drawFlags.sectioned = true;
                    }
                }
            }
            return true;
        }

        #updateDrawFlagsVisibleLayers() {
            const drawFlags = this.drawFlags;
            drawFlags.numLayers = this.layerList.length;
            drawFlags.numVisibleLayers = 0;
            for (let layerIndex = 0, len = this.layerList.length; layerIndex < len; layerIndex++) {
                const layer = this.layerList[layerIndex];
                const layerVisible = this.#getActiveSectionPlanesForLayer(layer);
                if (layerVisible) {
                    drawFlags.visibleLayers[drawFlags.numVisibleLayers++] = layerIndex;
                }
            }
        }

        #updateDrawFlags() {
            if (this.meshCounts.numVisible === 0) {
                return;
            }
            if (this.meshCounts.numCulled === this.meshCounts.numMeshes) {
                return;
            }
            const drawFlags = this.drawFlags;
            drawFlags.colorOpaque = (this.meshCounts.numTransparent < this.meshCounts.numMeshes);
            if (this.meshCounts.numTransparent > 0) {
                drawFlags.colorTransparent = true;
            }
            if (this.meshCounts.numXRayed > 0) {
                const xrayMaterial = this.#view.xrayMaterial.state;
                if (xrayMaterial.fill) {
                    if (xrayMaterial.fillAlpha < 1.0) {
                        drawFlags.xrayedSilhouetteTransparent = true;
                    } else {
                        drawFlags.xrayedSilhouetteOpaque = true;
                    }
                }
                if (xrayMaterial.edges) {
                    if (xrayMaterial.edgeAlpha < 1.0) {
                        drawFlags.xrayedEdgesTransparent = true;
                    } else {
                        drawFlags.xrayedEdgesOpaque = true;
                    }
                }
            }
            if (this.meshCounts.numEdges > 0) {
                const edgeMaterial = this.#view.edgeMaterial.state;
                if (edgeMaterial.edges) {
                    drawFlags.edgesOpaque = (this.meshCounts.numTransparent < this.meshCounts.numMeshes);
                    if (this.meshCounts.numTransparent > 0) {
                        drawFlags.edgesTransparent = true;
                    }
                }
            }
            if (this.meshCounts.numSelected > 0) {
                const selectedMaterial = this.#view.selectedMaterial.state;
                if (selectedMaterial.fill) {
                    if (selectedMaterial.fillAlpha < 1.0) {
                        drawFlags.selectedSilhouetteTransparent = true;
                    } else {
                        drawFlags.selectedSilhouetteOpaque = true;
                    }
                }
                if (selectedMaterial.edges) {
                    if (selectedMaterial.edgeAlpha < 1.0) {
                        drawFlags.selectedEdgesTransparent = true;
                    } else {
                        drawFlags.selectedEdgesOpaque = true;
                    }
                }
            }
            if (this.meshCounts.numHighlighted > 0) {
                const highlightMaterial = this.#view.highlightMaterial.state;
                if (highlightMaterial.fill) {
                    if (highlightMaterial.fillAlpha < 1.0) {
                        drawFlags.highlightedSilhouetteTransparent = true;
                    } else {
                        drawFlags.highlightedSilhouetteOpaque = true;
                    }
                }
                if (highlightMaterial.edges) {
                    if (highlightMaterial.edgeAlpha < 1.0) {
                        drawFlags.highlightedEdgesTransparent = true;
                    } else {
                        drawFlags.highlightedEdgesOpaque = true;
                    }
                }
            }
        }

     */


    // build() {
    //     if (this.destroyed) {
    //         this.log("rendererModel already destroyed");
    //         return;
    //     }
    //     if (this.built) {
    //         this.log("rendererModel already built");
    //         return;
    //     }
    //     for (let layerId in this.#currentLayers) {
    //         if (this.#currentLayers.hasOwnProperty(layerId)) {
    //             this.#currentLayers[layerId].build();
    //         }
    //     }
    //     for (let i = 0, len = this.objectList.length; i < len; i++) {
    //         const rendererObject = this.objectList[i];
    //         rendererObject.build();
    //     }
    //     for (let i = 0, len = this.objectList.length; i < len; i++) {
    //         const rendererObject = this.objectList[i];
    //         rendererObject.build2();
    //     }
    //     // this.layerList.sort((a, b) => {
    //     //     if (a.sortId < b.sortId) {
    //     //         return -1;
    //     //     }
    //     //     if (a.sortId > b.sortId) {
    //     //         return 1;
    //     //     }
    //     //     return 0;
    //     // });
    //     for (let i = 0, len = this.layerList.length; i < len; i++) {
    //         const layer = this.layerList[i];
    //         layer.layerIndex = i;
    //     }
    //     this.#currentLayers = {};
    //     this.built = true;
    //     this.#webglRenderer.setImageDirty();
    //     //     this.#view.viewer.scene.setAABBDirty();
    //     this.onBuilt.dispatch(this, null);
    // }
    //
    // addModel(params: {
    //     id: string,
    //     sceneModel: SceneModel
    // }) {
    //
    //     const sceneModel = params.sceneModel;
    //     const textures = sceneModel.textures;
    //     const geometries = sceneModel.geometries;
    //     const meshes = sceneModel.meshes;
    //     const objects = sceneModel.objects;
    //
    //     if (textures) {
    //         for (let textureId in textures) {
    //             const texture = textures[textureId];
    //             this.#attachTexture(texture);
    //         }
    //     }
    //
    //     if (geometries) {
    //         for (let geometryId in geometries) {
    //             const geometry = geometries[geometryId];
    //             this.#attachGeometry(geometry);
    //         }
    //     }
    //
    //     if (meshes) {
    //         for (let meshId in meshes) {
    //             const mesh = meshes[meshId];
    //             this.#attachMesh(mesh);
    //         }
    //     }
    //
    //     if (objects) {
    //         for (let geometryId in objects) {
    //             const object = objects[geometryId];
    //             this.#attachSceneObject(object);
    //         }
    //     }
    // }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.#detachSceneModel();
        this.#view.camera.onViewMatrix.unsubscribe(this.#onCameraViewMatrix);
        for (let layerId in this.#currentLayers) {
            if (this.#currentLayers.hasOwnProperty(layerId)) {
                this.#currentLayers[layerId].destroy();
            }
        }
        for (let i = 0, len = this.layerList.length; i < len; i++) {
            this.layerList[i].destroy();
        }
        for (let objectId in this.rendererObjects) {
            this.rendererObjects[objectId].destroy();
        }
        for (let meshId in this.rendererMeshes) {
            //    this.#webglRenderer.deregisterPickable(this.rendererMeshes[meshId].pickId);
        }
        this.#currentLayers = {};
        this.#layers = {};
        this.layerList = [];
        this.rendererGeometries = {};
        this.rendererTextures = {};
        this.rendererTextureSets = {};
        this.rendererMeshes = {};
        this.rendererViewObjects = {};
        // this.#view.viewer.setAABBDirty();
        this.onBuilt.clear();
        super.destroy();
    }

    #detachSceneModel(): void {
        const sceneModel = this.sceneModel;
        if (!sceneModel) {
            return;
        }
        const textures = sceneModel.textures;
        const geometries = sceneModel.geometries;
        const meshes = sceneModel.meshes;
        const objects = sceneModel.objects;
        if (textures) {
            for (let textureId in textures) {
                const texture = textures[textureId];
                if (texture.rendererTexture) {
                    texture.rendererTexture = null;
                }
            }
        }
        if (geometries) {
            for (let geometryId in geometries) {
                const geometry = geometries[geometryId];
                if (geometry.rendererGeometry) {
                    geometry.rendererGeometry = null;
                }
            }
        }
        if (meshes) {
            for (let meshId in meshes) {
                const mesh = meshes[meshId];
                if (mesh.rendererMesh) {
                    mesh.rendererMesh = null;
                }
            }
        }
        if (objects) {
            for (let objectId in objects) {
                const object = objects[objectId];
                if (object.rendererObject) {
                    object.rendererObject = null;
                }
            }
        }
        this.sceneModel = null;
    }
}



