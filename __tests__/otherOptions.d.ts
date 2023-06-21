import type {} from "graphile-config";
import type {} from "graphile-build-pg";
import type { PgSQL, SQL } from "pg-sql2";
import type { ConnectionStep, FieldArgs, ExecutableStep } from "grafast";
import type {
  PgCodecRelation,
  PgCodecWithAttributes,
  PgRegistry,
  PgSelectStep,
} from "@dataplan/pg";
import { TYPES, PgSelectSingleStep } from "@dataplan/pg";

// This file includes the types used in the tests for different keywords. It's
// just a copy of the 'archived' versions but with the keyword 'archived'
// replaced with whatever the new keyword is.

// archived -> draft
declare global {
  namespace GraphileBuild {
    interface Inflection {
      // If you use other keywords, you will need to declaration merge your own inflectors for TypeScript.
      includeDraftArgument(
        this: Inflection,
        details: {
          codec: PgCodecWithAttributes;
          registry: PgRegistry;
          relationName?: string;
        },
      ): string;
    }
    interface SchemaOptions {
      /**
       * The name of the column to use to determine if the record is draft
       * or not. Defaults to 'is_draft'
       */
      pgDraftColumnName?: string;
      /**
       * Set this true to invert the column logic - i.e. if your column is
       * `is_visible` instead of `is_draft`.
       */
      pgDraftColumnImpliesVisible?: boolean;
      /**
       * If your determination of whether a record is draft or not is more complex
       * than checking if a column is not null/not false then you can define an SQL
       * expression instead.
       */
      pgDraftExpression?: (sql: PgSQL, tableAlias: SQL) => SQL;
      /**
       * The default option to use for the 'includeDraft' argument. Defaults
       * to 'NO', but will be replaced with 'INHERIT' where possible unless you set
       * `pgDraftDefaultInherit` to false.
       */
      pgDraftDefault?: "INHERIT" | "NO" | "YES" | "EXCLUSIVELY";
      /**
       * Set false if you don't want the system to default to 'INHERIT' if it's
       * able to do so.
       */
      pgDraftDefaultInherit?: boolean;
      /**
       * Set true if you want related record collections to have the
       * pg-omit-draft behavior if they belong to a table that explicitly
       * matches.
       */
      pgDraftRelations?: boolean;
      /**
       * If you want the system to apply the draft filter to a specific list of tables, list their names here:
       */
      pgDraftTables?: string[];
    }
    interface ScopeObjectFieldsFieldArgs {
      /**
       * Set true if child fields should always include draft entries.
       */
      includeDraft?: boolean;
    }
  }
}
declare module "graphile-build-pg" {
  interface PgCodecRelationTags {
    draftRelation?: boolean;
  }
}

// archived -> statusArchived
declare global {
  namespace GraphileBuild {
    interface Inflection {
      // If you use other keywords, you will need to declaration merge your own inflectors for TypeScript.
      includeStatusArchivedArgument(
        this: Inflection,
        details: {
          codec: PgCodecWithAttributes;
          registry: PgRegistry;
          relationName?: string;
        },
      ): string;
    }
    interface SchemaOptions {
      /**
       * The name of the column to use to determine if the record is statusArchived
       * or not. Defaults to 'is_statusArchived'
       */
      pgStatusArchivedColumnName?: string;
      /**
       * Set this true to invert the column logic - i.e. if your column is
       * `is_visible` instead of `is_statusArchived`.
       */
      pgStatusArchivedColumnImpliesVisible?: boolean;
      /**
       * If your determination of whether a record is statusArchived or not is more complex
       * than checking if a column is not null/not false then you can define an SQL
       * expression instead.
       */
      pgStatusArchivedExpression?: (sql: PgSQL, tableAlias: SQL) => SQL;
      /**
       * The default option to use for the 'includeStatusArchived' argument. Defaults
       * to 'NO', but will be replaced with 'INHERIT' where possible unless you set
       * `pgStatusArchivedDefaultInherit` to false.
       */
      pgStatusArchivedDefault?: "INHERIT" | "NO" | "YES" | "EXCLUSIVELY";
      /**
       * Set false if you don't want the system to default to 'INHERIT' if it's
       * able to do so.
       */
      pgStatusArchivedDefaultInherit?: boolean;
      /**
       * Set true if you want related record collections to have the
       * pg-omit-statusArchived behavior if they belong to a table that explicitly
       * matches.
       */
      pgStatusArchivedRelations?: boolean;
      /**
       * If you want the system to apply the statusArchived filter to a specific list of tables, list their names here:
       */
      pgStatusArchivedTables?: string[];
    }
    interface ScopeObjectFieldsFieldArgs {
      /**
       * Set true if child fields should always include statusArchived entries.
       */
      includeStatusArchived?: boolean;
    }
  }
}
declare module "graphile-build-pg" {
  interface PgCodecRelationTags {
    statusArchivedRelation?: boolean;
  }
}

export {};
