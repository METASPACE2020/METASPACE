import {Brackets, EntityManager, ObjectType} from "typeorm";
import FormValidationErrors from "../../utils/FormValidationErrors";


interface EntityWithUrlSlug {
    id: string;
    urlSlug: string;
}

export const validateUrlSlugChange = async <EntityType extends ObjectType<EntityWithUrlSlug>>
    (entityManager: EntityManager, model: EntityType, existingId: string | null, urlSlug: string) => {

    if (/[^a-zA-Z0-9_-]/.test(urlSlug)) {
        throw new FormValidationErrors('urlSlug',
            'Invalid character in custom URL. Only English letters, numbers, underscore and minus are allowed.')
    }
    if (urlSlug.length < 4 || urlSlug.length > 50) {
        throw new FormValidationErrors('urlSlug', 'Custom URL must be between 4 and 50 characters.')
    }

    const existing = await entityManager.createQueryBuilder(model, 'entity')
        .where(urlSlugMatchesClause('entity', urlSlug))
        .getMany();

    if (existing.some(({id}) => existingId != null && id != existingId)) {
        throw new FormValidationErrors('urlSlug', 'This custom URL has already been used.')
    }
}

export const urlSlugMatchesClause = (relationName: string, urlSlug: string) => {
    return new Brackets(qb =>
        qb.where(`LOWER(REPLACE(${relationName}.urlSlug, '-', '_')) = LOWER(REPLACE(:urlSlug, '-', '_'))`,
            {urlSlug})
    )
}