/**
 * Parameters for creating a {@link @xeokit/data!Relationship} with {@link @xeokit/data!DataModel.createRelationship | DataModel.createRelationship}.
 *
 * See {@link "@xeokit/data"} for usage.
 */
export interface RelationshipParams {
    /**
     * The relationship type.
     */
    type: number;
    /**
     * The relating {@link DataObject}.
     */
    relatingObjectId: string;
    /**
     * The related {@link DataObject}.
     */
    relatedObjectId: string;
}
