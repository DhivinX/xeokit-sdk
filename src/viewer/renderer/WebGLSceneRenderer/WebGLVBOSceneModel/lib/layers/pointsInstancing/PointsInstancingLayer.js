import {ENTITY_FLAGS} from '../../ENTITY_FLAGS.js';
import {RENDER_PASSES} from '../../RENDER_PASSES.js';

import {math} from "../../../../../math/math.js";
import {RenderState} from "../../../../../webgl/RenderState.js";
import {ArrayBuf} from "../../../../../webgl/ArrayBuf.js";
import {getPointsInstancingRenderers} from "./PointsInstancingRenderers.js";

const tempUint8Vec4 = new Uint8Array(4);
const tempVec4a = math.vec4([0, 0, 0, 1]);
const tempVec4b = math.vec4([0, 0, 0, 1]);
const tempVec4c = math.vec4([0, 0, 0, 1]);
const tempVec3fa = new Float32Array(3);

/**
 * @private
 */
class PointsInstancingLayer {

    /**
     * @param cfg
     * @param cfg.layerIndex
     * @param cfg.model
     * @param cfg.geometry
     * @param cfg.material
     * @param cfg.origin
     */
    constructor(cfg) {

        /**
         * Owner model
         * @type {WebGLVBOSceneModel}
         */
        this.model = cfg.model;

        /**
         * Shared geometry
         * @type {WebGLVBOGeometry}
         */
        this.geometry = cfg.geometry;

        /**
         * Shared material
         * @type {WebGLVBOGeometry}
         */
        this.material = cfg.material;

        /**
         * State sorting key.
         * @type {string}
         */
        this.sortId = "PointsInstancingLayer";

        /**
         * Index of this InstancingLayer in VBOSceneModel#_layerList
         * @type {Number}
         */
        this.layerIndex = cfg.layerIndex;

        this._pointsInstancingRenderers = getPointsInstancingRenderers(cfg.model.scene);
        this._aabb = math.collapseAABB3();

        this.state = new RenderState({
            obb: math.OBB3(),
            numInstances: 0,
            origin: cfg.origin ? math.vec3(cfg.origin) : null
        });

        // These counts are used to avoid unnecessary render passes
        this.#numPortions = 0;
        this.#numVisibleLayerPortions = 0;
        this.#numTransparentLayerPortions = 0;
        this.#numXRayedLayerPortions = 0;
        this.#numHighlightedLayerPortions = 0;
        this.#numSelectedLayerPortions = 0;
        this.#numClippableLayerPortions = 0;
        this.#numEdgesLayerPortions = 0;
        this.#numPickableLayerPortions = 0;
        this.#numCulledLayerPortions = 0;

        /** @private */
        this.numIndices = cfg.geometry.numIndices;

        // Per-instance arrays
        this._pickColors = [];
        this._offsets = [];

        // Modeling matrix per instance, array for each column
        this._modelMatrixCol0 = [];
        this._modelMatrixCol1 = [];
        this._modelMatrixCol2 = [];

        this.#portions = [];

        this.#finalized = false;

        /**
         * The axis-aligned World-space boundary of this InstancingLayer's positions.
         * @type {*|Float64Array}
         */
        this.aabb = math.collapseAABB3();
    }

    /**
     * Creates a new portion within this InstancingLayer, returns the new portion ID.
     *
     * The portion will instance this InstancingLayer's geometry.
     *
     * Gives the portion the specified color and matrix.
     *
     * @param cfg Portion params
     * @param cfg.meshMatrix Flat float 4x4 matrix.
     * @param [cfg.worldMatrix] Flat float 4x4 matrix.
     * @param cfg.aabb Flat float AABB.
     * @param cfg.pickColor Quantized pick color
     * @returns {number} Portion ID.
     */
    createPortion(cfg) {

        const meshMatrix = cfg.meshMatrix;
        const worldMatrix = cfg.worldMatrix;
        const worldAABB = cfg.aabb;
        const pickColor = cfg.pickColor;

        if (this.#finalized) {
            throw "Already finalized";
        }

        if (this.model.scene.entityOffsetsEnabled) {
            this._offsets.push(0);
            this._offsets.push(0);
            this._offsets.push(0);
        }

        this._modelMatrixCol0.push(meshMatrix[0]);
        this._modelMatrixCol0.push(meshMatrix[4]);
        this._modelMatrixCol0.push(meshMatrix[8]);
        this._modelMatrixCol0.push(meshMatrix[12]);

        this._modelMatrixCol1.push(meshMatrix[1]);
        this._modelMatrixCol1.push(meshMatrix[5]);
        this._modelMatrixCol1.push(meshMatrix[9]);
        this._modelMatrixCol1.push(meshMatrix[13]);

        this._modelMatrixCol2.push(meshMatrix[2]);
        this._modelMatrixCol2.push(meshMatrix[6]);
        this._modelMatrixCol2.push(meshMatrix[10]);
        this._modelMatrixCol2.push(meshMatrix[14]);

        // Per-instance pick colors

        this._pickColors.push(pickColor[0]);
        this._pickColors.push(pickColor[1]);
        this._pickColors.push(pickColor[2]);
        this._pickColors.push(pickColor[3]);

        // Expand AABB

        math.collapseAABB3(worldAABB);
        const obb = this.state.obb;
        const lenPositions = obb.length;
        for (let i = 0; i < lenPositions; i += 4) {
            tempVec4a[0] = obb[i + 0];
            tempVec4a[1] = obb[i + 1];
            tempVec4a[2] = obb[i + 2];
            math.transformPoint4(meshMatrix, tempVec4a, tempVec4b);
            if (worldMatrix) {
                math.transformPoint4(worldMatrix, tempVec4b, tempVec4c);
                math.expandAABB3Point3(worldAABB, tempVec4c);
            } else {
                math.expandAABB3Point3(worldAABB, tempVec4b);
            }
        }

        if (this.state.origin) {
            const origin = this.state.origin;
            worldAABB[0] += origin[0];
            worldAABB[1] += origin[1];
            worldAABB[2] += origin[2];
            worldAABB[3] += origin[0];
            worldAABB[4] += origin[1];
            worldAABB[5] += origin[2];
        }

        math.expandAABB3(this.aabb, worldAABB);

        this.state.numInstances++;

        const portionId = this.#portions.length;
        this.#portions.push({});

        this.#numPortions++;
        this.model.numPortions++;

        return portionId;
    }

    finalize() {
        if (this.#finalized) {
            throw "Already finalized";
        }
        const gl = this.model.scene.canvas.gl;
        const flagsLength = this._pickColors.length;
        if (flagsLength > 0) {
            // Because we only build flags arrays here, 
            // get their length from the colors array
            let notNormalized = false;
            let normalized = true;
            this.state.flagsBuf = new ArrayBuf(gl, gl.ARRAY_BUFFER, new Uint8Array(flagsLength), flagsLength, 4, gl.DYNAMIC_DRAW, notNormalized);
            this.state.flags2Buf = new ArrayBuf(gl, gl.ARRAY_BUFFER, new Uint8Array(flagsLength), flagsLength, 4, gl.DYNAMIC_DRAW, normalized);
        }
        if (this.model.scene.entityOffsetsEnabled) {
            if (this._offsets.length > 0) {
                const notNormalized = false;
                this.state.offsetsBuf = new ArrayBuf(gl, gl.ARRAY_BUFFER, new Float32Array(this._offsets), this._offsets.length, 3, gl.DYNAMIC_DRAW, notNormalized);
                this._offsets = []; // Release memory
            }
        }
        if (this._modelMatrixCol0.length > 0) {
            const normalized = false;
            this.state.modelMatrixCol0Buf = new ArrayBuf(gl, gl.ARRAY_BUFFER, new Float32Array(this._modelMatrixCol0), this._modelMatrixCol0.length, 4, gl.STATIC_DRAW, normalized);
            this.state.modelMatrixCol1Buf = new ArrayBuf(gl, gl.ARRAY_BUFFER, new Float32Array(this._modelMatrixCol1), this._modelMatrixCol1.length, 4, gl.STATIC_DRAW, normalized);
            this.state.modelMatrixCol2Buf = new ArrayBuf(gl, gl.ARRAY_BUFFER, new Float32Array(this._modelMatrixCol2), this._modelMatrixCol2.length, 4, gl.STATIC_DRAW, normalized);
            this._modelMatrixCol0 = [];
            this._modelMatrixCol1 = [];
            this._modelMatrixCol2 = [];
        }
        if (this._pickColors.length > 0) {
            const normalized = false;
            this.state.pickColorsBuf = new ArrayBuf(gl, gl.ARRAY_BUFFER, new Uint8Array(this._pickColors), this._pickColors.length, 4, gl.STATIC_DRAW, normalized);
            this._pickColors = []; // Release memory
        }
        this.#finalized = true;
    }

    // The following setters are called by VBOSceneModelMesh, in turn called by VBOSceneModelNode, only after the layer is finalized.
    // It's important that these are called after finalize() in order to maintain integrity of counts like #numVisibleLayerPortions etc.

    initFlags(portionId: number, flags, meshTransparent) {
        if (flags & ENTITY_FLAGS.VISIBLE) {
            this.#numVisibleLayerPortions++;
            this.model.numVisibleLayerPortions++;
        }
        if (flags & ENTITY_FLAGS.HIGHLIGHTED) {
            this.#numHighlightedLayerPortions++;
            this.model.numHighlightedLayerPortions++;
        }
        if (flags & ENTITY_FLAGS.XRAYED) {
            this.#numXRayedLayerPortions++;
            this.model.numXRayedLayerPortions++;
        }
        if (flags & ENTITY_FLAGS.SELECTED) {
            this.#numSelectedLayerPortions++;
            this.model.numSelectedLayerPortions++;
        }
        if (flags & ENTITY_FLAGS.CLIPPABLE) {
            this.#numClippableLayerPortions++;
            this.model.numClippableLayerPortions++;
        }
        if (flags & ENTITY_FLAGS.EDGES) {
            this.#numEdgesLayerPortions++;
            this.model.numEdgesLayerPortions++;
        }
        if (flags & ENTITY_FLAGS.PICKABLE) {
            this.#numPickableLayerPortions++;
            this.model.numPickableLayerPortions++;
        }
        if (flags & ENTITY_FLAGS.CULLED) {
            this.#numCulledLayerPortions++;
            this.model.numCulledLayerPortions++;
        }
        if (meshTransparent) {
            this.#numTransparentLayerPortions++;
            this.model.numTransparentLayerPortions++;
        }
        this._setFlags(portionId, flags, meshTransparent);
        this._setFlags2(portionId, flags);
    }

    setVisible(portionId: number, flags, meshTransparent) {
        if (!this.#finalized) {
            throw "Not finalized";
        }
        if (flags & ENTITY_FLAGS.VISIBLE) {
            this.#numVisibleLayerPortions++;
            this.model.numVisibleLayerPortions++;
        } else {
            this.#numVisibleLayerPortions--;
            this.model.numVisibleLayerPortions--;
        }
        this._setFlags(portionId, flags, meshTransparent);
    }

    setHighlighted(portionId: number, flags, meshTransparent) {
        if (!this.#finalized) {
            throw "Not finalized";
        }
        if (flags & ENTITY_FLAGS.HIGHLIGHTED) {
            this.#numHighlightedLayerPortions++;
            this.model.numHighlightedLayerPortions++;
        } else {
            this.#numHighlightedLayerPortions--;
            this.model.numHighlightedLayerPortions--;
        }
        this._setFlags(portionId, flags, meshTransparent);
    }

    setXRayed(portionId: number, flags, meshTransparent) {
        if (!this.#finalized) {
            throw "Not finalized";
        }
        if (flags & ENTITY_FLAGS.XRAYED) {
            this.#numXRayedLayerPortions++;
            this.model.numXRayedLayerPortions++;
        } else {
            this.#numXRayedLayerPortions--;
            this.model.numXRayedLayerPortions--;
        }
        this._setFlags(portionId, flags, meshTransparent);
    }

    setSelected(portionId: number, flags, meshTransparent) {
        if (!this.#finalized) {
            throw "Not finalized";
        }
        if (flags & ENTITY_FLAGS.SELECTED) {
            this.#numSelectedLayerPortions++;
            this.model.numSelectedLayerPortions++;
        } else {
            this.#numSelectedLayerPortions--;
            this.model.numSelectedLayerPortions--;
        }
        this._setFlags(portionId, flags, meshTransparent);
    }

    setEdges(portionId: number, flags, meshTransparent) {
        if (!this.#finalized) {
            throw "Not finalized";
        }
        if (flags & ENTITY_FLAGS.EDGES) {
            this.#numEdgesLayerPortions++;
            this.model.numEdgesLayerPortions++;
        } else {
            this.#numEdgesLayerPortions--;
            this.model.numEdgesLayerPortions--;
        }
        this._setFlags(portionId, flags, meshTransparent);
    }

    setClippable(portionId: number, flags) {
        if (!this.#finalized) {
            throw "Not finalized";
        }
        if (flags & ENTITY_FLAGS.CLIPPABLE) {
            this.#numClippableLayerPortions++;
            this.model.numClippableLayerPortions++;
        } else {
            this.#numClippableLayerPortions--;
            this.model.numClippableLayerPortions--;
        }
        this._setFlags2(portionId, flags);
    }

    setCollidable(portionId: number, flags) {
        if (!this.#finalized) {
            throw "Not finalized";
        }
    }

    setPickable(portionId: number, flags, meshTransparent) {
        if (!this.#finalized) {
            throw "Not finalized";
        }
        if (flags & ENTITY_FLAGS.PICKABLE) {
            this.#numPickableLayerPortions++;
            this.model.numPickableLayerPortions++;
        } else {
            this.#numPickableLayerPortions--;
            this.model.numPickableLayerPortions--;
        }
        this._setFlags2(portionId, flags, meshTransparent);
    }

    setCulled(portionId: number, flags, meshTransparent) {
        if (!this.#finalized) {
            throw "Not finalized";
        }
        if (flags & ENTITY_FLAGS.CULLED) {
            this.#numCulledLayerPortions++;
            this.model.numCulledLayerPortions++;
        } else {
            this.#numCulledLayerPortions--;
            this.model.numCulledLayerPortions--;
        }
        this._setFlags(portionId, flags, meshTransparent);
    }

    setColor(portionId: number, color) { // RGBA color is normalized as ints
        if (!this.#finalized) {
            throw "Not finalized";
        }
        tempUint8Vec4[0] = color[0];
        tempUint8Vec4[1] = color[1];
        tempUint8Vec4[2] = color[2];
        this.state.colorsBuf.setData(tempUint8Vec4, portionId * 3, 3);
    }

    setTransparent(portionId: number, flags, transparent) {
        if (transparent) {
            this.#numTransparentLayerPortions++;
            this.model.numTransparentLayerPortions++;
        } else {
            this.#numTransparentLayerPortions--;
            this.model.numTransparentLayerPortions--;
        }
        this._setFlags(portionId, flags, transparent);
    }

    // setMatrix(portionId, matrix) {
    //
    //     if (!this.#finalized) {
    //         throw "Not finalized";
    //     }
    //
    //     var offset = portionId * 4;
    //
    //     tempFloat32Vec4[0] = matrix[0];
    //     tempFloat32Vec4[1] = matrix[4];
    //     tempFloat32Vec4[2] = matrix[8];
    //     tempFloat32Vec4[3] = matrix[12];
    //
    //     this.state.modelMatrixCol0Buf.setData(tempFloat32Vec4, offset, 4);
    //
    //     tempFloat32Vec4[0] = matrix[1];
    //     tempFloat32Vec4[1] = matrix[5];
    //     tempFloat32Vec4[2] = matrix[9];
    //     tempFloat32Vec4[3] = matrix[13];
    //
    //     this.state.modelMatrixCol1Buf.setData(tempFloat32Vec4, offset, 4);
    //
    //     tempFloat32Vec4[0] = matrix[2];
    //     tempFloat32Vec4[1] = matrix[6];
    //     tempFloat32Vec4[2] = matrix[10];
    //     tempFloat32Vec4[3] = matrix[14];
    //
    //     this.state.modelMatrixCol2Buf.setData(tempFloat32Vec4, offset, 4);
    // }

    _setFlags(portionId: number, flags, meshTransparent) {

        if (!this.#finalized) {
            throw "Not finalized";
        }

        const visible = !!(flags & ENTITY_FLAGS.VISIBLE);
        const xrayed = !!(flags & ENTITY_FLAGS.XRAYED);
        const highlighted = !!(flags & ENTITY_FLAGS.HIGHLIGHTED);
        const selected = !!(flags & ENTITY_FLAGS.SELECTED);
        const edges = !!(flags & ENTITY_FLAGS.EDGES);
        const pickable = !!(flags & ENTITY_FLAGS.PICKABLE);
        const culled = !!(flags & ENTITY_FLAGS.CULLED);

        // Normal fill

        let f0;
        if (!visible || culled || xrayed
            || (highlighted && !this.model.scene.highlightMaterial.glowThrough)
            || (selected && !this.model.scene.selectedMaterial.glowThrough) ) {
            f0 = RENDER_PASSES.NOT_RENDERED;
        } else {
            if (meshTransparent) {
                f0 = RENDER_PASSES.COLOR_TRANSPARENT;
            } else {
                f0 = RENDER_PASSES.COLOR_OPAQUE;
            }
        }

        // Emphasis fill

        let f1;
        if (!visible || culled) {
            f1 = RENDER_PASSES.NOT_RENDERED;
        } else if (selected) {
            f1 = RENDER_PASSES.SILHOUETTE_SELECTED;
        } else if (highlighted) {
            f1 = RENDER_PASSES.SILHOUETTE_HIGHLIGHTED;
        } else if (xrayed) {
            f1 = RENDER_PASSES.SILHOUETTE_XRAYED;
        } else {
            f1 = RENDER_PASSES.NOT_RENDERED;
        }

        // Edges

        let f2 = 0;
        if (!visible || culled) {
            f2 = RENDER_PASSES.NOT_RENDERED;
        } else if (selected) {
            f2 = RENDER_PASSES.EDGES_SELECTED;
        } else if (highlighted) {
            f2 = RENDER_PASSES.EDGES_HIGHLIGHTED;
        } else if (xrayed) {
            f2 = RENDER_PASSES.EDGES_XRAYED;
        } else if (edges) {
            if (meshTransparent) {
                f2 = RENDER_PASSES.EDGES_COLOR_TRANSPARENT;
            } else {
                f2 = RENDER_PASSES.EDGES_COLOR_OPAQUE;
            }
        } else {
            f2 = RENDER_PASSES.NOT_RENDERED;
        }

        // Pick

        let f3 = (visible && !culled && pickable) ? RENDER_PASSES.PICK : RENDER_PASSES.NOT_RENDERED;

        tempUint8Vec4[0] = f0; // x - normal fill
        tempUint8Vec4[1] = f1; // y - emphasis fill
        tempUint8Vec4[2] = f2; // z - edges
        tempUint8Vec4[3] = f3; // w - pick

        this.state.flagsBuf.setData(tempUint8Vec4, portionId * 4, 4);
    }

    _setFlags2(portionId: number, flags) {

        if (!this.#finalized) {
            throw "Not finalized";
        }

        const clippable = !!(flags & ENTITY_FLAGS.CLIPPABLE) ? 255 : 0;
        tempUint8Vec4[0] = clippable;

        this.state.flags2Buf.setData(tempUint8Vec4, portionId * 4, 4);
    }

    setOffset(portionId: number, offset) {
        if (!this.#finalized) {
            throw "Not finalized";
        }
        if (!this.model.scene.entityOffsetsEnabled) {
            this.model.error("Entity#offset not enabled for this Viewer"); // See Viewer entityOffsetsEnabled
            return;
        }
        tempVec3fa[0] = offset[0];
        tempVec3fa[1] = offset[1];
        tempVec3fa[2] = offset[2];
        this.state.offsetsBuf.setData(tempVec3fa, portionId * 3, 3);
    }

    // ---------------------- NORMAL RENDERING -----------------------------------

    drawColorOpaque(renderFlags: RenderFlags, frameCtx: FrameContext): void {
        if (this.#numCulledLayerPortions === this.#numPortions || this.#numVisibleLayerPortions === 0 || this.#numTransparentLayerPortions === this.#numPortions || this.#numXRayedLayerPortions === this.#numPortions) {
            return;
        }
        if (this._pointsInstancingRenderers.colorRenderer) {
            this._pointsInstancingRenderers.colorRenderer.drawLayer(frameCtx, this, RENDER_PASSES.COLOR_OPAQUE);
        }
    }

    drawColorTransparent(renderFlags: RenderFlags, frameCtx: FrameContext): void {
        if (this.#numCulledLayerPortions === this.#numPortions || this.#numVisibleLayerPortions === 0 || this.#numTransparentLayerPortions === 0 || this.#numXRayedLayerPortions === this.#numPortions) {
            return;
        }
        if (this._pointsInstancingRenderers.colorRenderer) {
            this._pointsInstancingRenderers.colorRenderer.drawLayer(frameCtx, this, RENDER_PASSES.COLOR_TRANSPARENT);
        }
    }

    // -- RENDERING SAO POST EFFECT TARGETS ----------------------------------------------------------------------------

    drawDepth(renderFlags: RenderFlags, frameCtx: FrameContext): void {
    }

    drawNormals(renderFlags: RenderFlags, frameCtx: FrameContext): void {
    }

    // ---------------------- EMPHASIS RENDERING -----------------------------------

    drawSilhouetteXRayed(renderFlags: RenderFlags, frameCtx: FrameContext): void {
        if (this.#numCulledLayerPortions === this.#numPortions || this.#numVisibleLayerPortions === 0 || this.#numXRayedLayerPortions === 0) {
            return;
        }
        if (this._pointsInstancingRenderers.silhouetteRenderer) {
            this._pointsInstancingRenderers.silhouetteRenderer.drawLayer(frameCtx, this, RENDER_PASSES.SILHOUETTE_XRAYED);
        }
    }

    drawSilhouetteHighlighted(renderFlags: RenderFlags, frameCtx: FrameContext): void {
        if (this.#numCulledLayerPortions === this.#numPortions || this.#numVisibleLayerPortions === 0 || this.#numHighlightedLayerPortions === 0) {
            return;
        }
        if (this._pointsInstancingRenderers.silhouetteRenderer) {
            this._pointsInstancingRenderers.silhouetteRenderer.drawLayer(frameCtx, this, RENDER_PASSES.SILHOUETTE_HIGHLIGHTED);
        }
    }

    drawSilhouetteSelected(renderFlags: RenderFlags, frameCtx: FrameContext): void {
        if (this.#numCulledLayerPortions === this.#numPortions || this.#numVisibleLayerPortions === 0 || this.#numSelectedLayerPortions === 0) {
            return;
        }
        if (this._pointsInstancingRenderers.silhouetteRenderer) {
            this._pointsInstancingRenderers.silhouetteRenderer.drawLayer(frameCtx, this, RENDER_PASSES.SILHOUETTE_SELECTED);
        }
    }

    //-- EDGES RENDERING -----------------------------------------------------------------------------------------------

    drawEdgesColorOpaque(renderFlags: RenderFlags, frameCtx: FrameContext): void {
    }

    drawEdgesColorTransparent(renderFlags: RenderFlags, frameCtx: FrameContext): void {
    }

    drawEdgesHighlighted(renderFlags: RenderFlags, frameCtx: FrameContext): void {
    }

    drawEdgesSelected(renderFlags: RenderFlags, frameCtx: FrameContext): void {
    }

    drawEdgesXRayed(renderFlags: RenderFlags, frameCtx: FrameContext): void {
    }

    // ---------------------- OCCLUSION CULL RENDERING -----------------------------------

    drawOcclusion(renderFlags: RenderFlags, frameCtx: FrameContext): void {
        if (this.#numCulledLayerPortions === this.#numPortions || this.#numVisibleLayerPortions === 0) {
            return;
        }
        if (this._pointsInstancingRenderers.occlusionRenderer) {
            // Only opaque, filled objects can be occluders
            this._pointsInstancingRenderers.occlusionRenderer.drawLayer(frameCtx, this, RENDER_PASSES.COLOR_OPAQUE);
        }
    }

    // ---------------------- SHADOW BUFFER RENDERING -----------------------------------

    drawShadow(renderFlags: RenderFlags, frameCtx: FrameContext): void {
    }

    //---- PICKING ----------------------------------------------------------------------------------------------------

    drawPickMesh(renderFlags: RenderFlags, frameCtx: FrameContext): void {
        if (this.#numCulledLayerPortions === this.#numPortions || this.#numVisibleLayerPortions === 0) {
            return;
        }
        if (this._pointsInstancingRenderers.pickMeshRenderer) {
            this._pointsInstancingRenderers.pickMeshRenderer.drawLayer(frameCtx, this, RENDER_PASSES.PICK);
        }
    }

    drawPickDepths(renderFlags: RenderFlags, frameCtx: FrameContext): void {
        if (this.#numCulledLayerPortions === this.#numPortions || this.#numVisibleLayerPortions === 0) {
            return;
        }
        if (this._pointsInstancingRenderers.pickDepthRenderer) {
            this._pointsInstancingRenderers.pickDepthRenderer.drawLayer(frameCtx, this, RENDER_PASSES.PICK);
        }
    }

    drawPickNormals(renderFlags: RenderFlags, frameCtx: FrameContext): void {
    }

    destroy() {
        const state = this.state;
        if (state.colorsBuf) {
            state.colorsBuf.destroy();
            state.colorsBuf = null;
        }
        if (state.flagsBuf) {
            state.flagsBuf.destroy();
            state.flagsBuf = null;
        }
        if (state.flags2Buf) {
            state.flags2Buf.destroy();
            state.flags2Buf = null;
        }
        if (state.offsetsBuf) {
            state.offsetsBuf.destroy();
            state.offsetsBuf = null;
        }
        if (state.modelMatrixCol0Buf) {
            state.modelMatrixCol0Buf.destroy();
            state.modelMatrixCol0Buf = null;
        }
        if (state.modelMatrixCol1Buf) {
            state.modelMatrixCol1Buf.destroy();
            state.modelMatrixCol1Buf = null;
        }
        if (state.modelMatrixCol2Buf) {
            state.modelMatrixCol2Buf.destroy();
            state.modelMatrixCol2Buf = null;
        }
        if (state.pickColorsBuf) {
            state.pickColorsBuf.destroy();
            state.pickColorsBuf = null;
        }
        state.destroy();
    }
}

export {PointsInstancingLayer};