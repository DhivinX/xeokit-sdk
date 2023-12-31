import type { PropertySetParams } from "./PropertySetParams";
import type { DataObjectParams } from "./DataObjectParams";
import type { RelationshipParams } from "./RelationshipParams";
/**
 * Parameters for creating a {@link @xeokit/data!DataModel} with {@link @xeokit/data!Data.createModel | Data.createModel}.
 *
 * See {@link "@xeokit/data"} for usage.
 */
export interface DataModelParams {
    /**
     * Unique ID of the DataModel.
     *
     * The DataModel is stored in {@link @xeokit/data!Data.models | Data.models} under this ID.
     */
    id: string;
    /**
     * The project ID, if available.
     */
    projectId?: string | number;
    /**
     * The data model model ID, if available.
     */
    revisionId?: string | number;
    /**
     * The data model author, if available.
     */
    author?: string;
    /**
     * The data the model was created, if available.
     */
    createdAt?: string;
    /**
     * The application that created the data model, if known.
     */
    creatingApplication?: string;
    /**
     * The data model schema version, if available.
     */
    schema?: string;
    /**
     * The{@link @xeokit/data!PropertySet | PropertySets} in the DataModel.
     */
    propertySets?: PropertySetParams[];
    /**
     * The {@link @xeokit/data!DataObject | DataObjects} in the DataModel.
     */
    objects?: DataObjectParams[];
    /**
     * The {@link @xeokit/data!Relationship | Relationshipships} in the DataModel.
     */
    relationships?: RelationshipParams[];
}
