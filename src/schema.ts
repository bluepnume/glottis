// Schemas for arguments and props: any Standard Schema validator (zod,
// valibot, arktype) validates and types; JSON Schema for the manifest comes
// from the Standard JSON Schema extension when the validator has it, from an
// explicit `jsonSchema`, or is the schema itself when it is plain JSON Schema.

import { ValidationError } from './errors';

type StandardIssue = {
    readonly message : string,
    readonly path ?: ReadonlyArray<PropertyKey | { readonly key : PropertyKey }>,
};

type StandardResult<Output> = { readonly value : Output, readonly issues ?: undefined }
    | { readonly issues : ReadonlyArray<StandardIssue> };

// The Standard Schema v1 interface, as zod, valibot and arktype implement it.
export type StandardSchema<Input = unknown, Output = Input> = {
    readonly '~standard' : {
        readonly version : 1,
        readonly vendor : string,
        readonly validate : (value : unknown) => StandardResult<Output> | Promise<StandardResult<Output>>,
        readonly types ?: { readonly input : Input, readonly output : Output },
        readonly jsonSchema ?: {
            readonly input : (options : {
                readonly target : string,
                readonly libraryOptions ?: Readonly<Record<string, unknown>>,
            }) => Record<string, unknown>,
        },
    },
};

export type JsonSchema = Readonly<Record<string, unknown>>;

// A schema option: a validator, or plain JSON Schema used as metadata only.
export type Schema = StandardSchema | JsonSchema;

export type InferOutput<S> = S extends StandardSchema<unknown, infer Output>
    ? Output
    : unknown;

export const isStandardSchema = (schema : unknown) : schema is StandardSchema =>
    typeof schema === 'object' && schema !== null && '~standard' in schema;

type ValidateOptions = {
    readonly schema : Schema | undefined,
    readonly value : unknown,
    readonly subject : string,
};

// Runs the validator, if there is one, and returns the value it produced
// (with defaults applied); plain JSON Schema passes the value through.
export const validate = async ({ schema, value, subject } : ValidateOptions) : Promise<unknown> => {
    if (!isStandardSchema(schema)) {
        return value;
    }

    const result = await schema['~standard'].validate(value);

    if (result.issues) {
        throw new ValidationError({ subject, issues: result.issues });
    }

    return result.value;
};

const JSON_SCHEMA_TARGET = 'draft-2020-12';

type ToJsonSchemaOptions = {
    readonly schema : Schema | undefined,
    readonly explicit ?: JsonSchema,
};

export const toJsonSchema = ({ schema, explicit } : ToJsonSchemaOptions) : JsonSchema | undefined => {
    if (explicit) {
        return explicit;
    }

    if (!schema) {
        return undefined;
    }

    if (!isStandardSchema(schema)) {
        return schema;
    }

    // Types JSON Schema cannot express, like functions in props, become
    // open schemas rather than failing the whole manifest.
    try {
        return schema['~standard'].jsonSchema?.input({
            target:         JSON_SCHEMA_TARGET,
            libraryOptions: { unrepresentable: 'any' }
        });
    } catch {
        return undefined;
    }
};
