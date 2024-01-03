import type { PropertyParams } from "./PropertyParams";
/**
 * Parameters for creating a {@link @xeokit/data!PropertySet} with {@link @xeokit/data!DataModel.createPropertySet | DataModel.createPropertySet}.
 *
 * See {@link "@xeokit/data"} for usage.
 */
export interface PropertySetParams {
    /**
     * Unique ID of the PropertySet.
     *
     * PropertySets are stored by ID in {@link @xeokit/data!Data.propertySets | Data.propertySets} and {@link DataModel.propertySets | DataModel.propertySets}.
     */
    id: string;
    /**
     * Human-readable name of the PropertySet.
     */
    name: string;
    /**
     * Type of each PropertySet.
     */
    type: string;
    /**
     * The {@link Property | Properties} within the PropertySet.
     */
    properties: PropertyParams[];
}
