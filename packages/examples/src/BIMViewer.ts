import {View, Viewer} from "@xeokit/viewer";
import {WebGLRenderer} from "@xeokit/webgl";
import {KTX2TextureTranscoder} from "@xeokit/ktx2";
import {loadXKT, saveXKT} from "@xeokit/xkt";
import {CameraControl} from "@xeokit/controls";
import {
    BCFViewpoint,
    loadBCFViewpoint,
    LoadBCFViewpointOptions,
    saveBCFViewpoint,
    SaveBCFViewpointOptions
} from "@xeokit/bcf";
import {LocaleService} from "@xeokit/locale";
import {Data, DataModel} from "@xeokit/datamodel";
import {Model} from "@xeokit/core/components";


/**
 *
 */
export interface LoadProjectParams {
    models: string[];
    dataModels: string[];
}

/**
 * TODO
 */
export class Project {
    dataModels: { [key: string]: DataModel };
    models: { [key: string]: Model };
}

/**
 * TODO
 */
export class BIMViewer extends Viewer {

    /**
     * TODO
     */
    readonly options: {
        saveBCF: SaveBCFViewpointOptions,
        loadBCF: LoadBCFViewpointOptions
    }

    /**
     * TODO
     */
    readonly data: Data;

    /**
     * TODO
     */
    readonly cameraControl: CameraControl;

    /**
     * TODO
     */
    readonly view: View;

    /**
     * TODO
     */
    readonly localeService: LocaleService;

    /**
     * TODO
     */
    project?: Project;

    /**
     * TODO
     * @param cfg
     */
    constructor(cfg: {
        canvasElement: HTMLCanvasElement;
    }) {
        super({
            id: "myViewer",
            renderer: new WebGLRenderer({
                textureTranscoder: new KTX2TextureTranscoder({
                    //  transcoderPath: "./../dist/basis/" // Optional, path to BasisU transcoder module
                })
            })
        });

        this.data = new Data();

        this.view = this.createView({
            canvasElement: cfg.canvasElement
        });

        this.cameraControl = new CameraControl(this.view, {});

        this.localeService = new LocaleService({});

        this.options = {
            saveBCF: {},
            loadBCF: {}
        };

        this.project = null;
    }

    /**
     * TODO
     * @param project
     */
    loadProject(project: LoadProjectParams) {

        // if (this.project) {
        //     // this.project.destroy();
        // }
        //
        // this.project = new Project({
        //
        // });
        //
        // return this.project;
    }

    /**
     *
     * @param cfg
     */
    loadDataModel(cfg: {
        id: string;
        src: string;
    }) {

    }

    /**
     * TODO
     * @param cfg
     */
    loadModel(cfg: {
        id: string;
        src: string;
    }) {
        return new Promise<void>((resolve, reject) => {

            // const model = this.createModel({
            //     id: cfg.id
            // });
            // const dataModel = this.data.createModel({
            //     id: cfg.id
            // })
            // fetch(cfg.src)
            //     .then(response => {
            //         if (response.ok) {
            //             response.arrayBuffer()
            //                 .then(data => {
            //                     loadXKT({data, model, dataModel})
            //                         .then(() => {
            //                             model.build();
            //                             dataModel.build();
            //                             resolve();
            //                         });
            //                 })
            //         }
            //     });
        });

    }

    /**
     * TODO
     * @param id
     */
    unloadModel(id: string) {

    }

    /**
     * Save a model as an XKT ArrayBuffer.
     * @param id
     */
    saveModel(id: string): ArrayBuffer {
        const viewerModel = this.scene.models[id];
        if (!viewerModel) {
            throw new Error(`Model not found: '$id'`);
        }
        return saveXKT({model: viewerModel});
    }

    /**
     * TODO
     */
    clearModels() {

    }

    /**
     * TODO
     * @param bcfViewpoint
     */
    loadBCF(bcfViewpoint: BCFViewpoint) {
        loadBCFViewpoint(bcfViewpoint, this.view, this.options.loadBCF);
    }

    /**
     * TODO
     */
    saveBCF(): BCFViewpoint {
        return saveBCFViewpoint(this.view, this.options.saveBCF);
    }
}