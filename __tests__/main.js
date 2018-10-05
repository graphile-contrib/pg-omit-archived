const { graphql } = require("graphql");
const pg = require("pg");
const {
  createPostGraphileSchema,
  withPostGraphileContext,
} = require("postgraphile");
const SQL = `
drop schema if exists omit_archived cascade;
create schema omit_archived;
create table omit_archived.parents (
  id int primary key,
  name text,
  is_archived boolean not null default false
);
create table omit_archived.children (
  id int primary key,
  parent_id int not null references omit_archived.parents,
  name text,
  is_archived boolean not null default false
);
create index on omit_archived.children(parent_id);
insert into omit_archived.parents (id, name, is_archived) values (1, 'First', false), (2, 'Second', true), (3, 'Third', false);
insert into omit_archived.children (id, parent_id, name, is_archived) values
  (1001, 1, 'First child 1', false), (1002, 1, 'First child 2', true), (1003, 1, 'First child 3', false),
  (2001, 1, 'Second child 1', false), (2002, 1, 'Second child 2', true), (2003, 1, 'Second child 3', false),
  (3001, 1, 'Third child 1', false), (3002, 1, 'Third child 2', true), (3003, 1, 'Third child 3', false);
`;

let pgPool;
let schema;
const options = {
  appendPlugins: [require("..")],
};
beforeAll(() => {
  pgPool = new pg.Pool({
    connectionString: process.env.TEST_DATABASE_URL || "pggql_test",
  });
});
beforeAll(() => pgPool.query(SQL));
beforeAll(async () => {
  schema = await createPostGraphileSchema(pgPool, ["omit_archived"], options);
});
afterAll(() => pgPool.end());

function check(query, expected) {
  const rootValue = null;
  const variables = {};
  const operationName = null;
  return () =>
    withPostGraphileContext(
      {
        pgPool,
        ...options,
      },
      async context => {
        const result = await graphql(
          schema,
          query,
          rootValue,
          context,
          variables,
          operationName
        );
        expect(result.errors).toBeFalsy();
        expect(result.data).toEqual(expected);
      }
    );
}

test(
  "Omits archived parents by default",
  check(
    `{
      allParents {
        nodes {
          id
        }
      }
    }`,
    { allParents: { nodes: [{ id: 1 }, { id: 3 }] } }
  )
);

test(
  "Omits archived parents when NO",
  check(
    `{
      allParents(includeArchived: NO) {
        nodes {
          id
        }
      }
    }`,
    { allParents: { nodes: [{ id: 1 }, { id: 3 }] } }
  )
);

test(
  "Includes everything when YES",
  check(
    `{
      allParents(includeArchived: YES) {
        nodes {
          id
        }
      }
    }`,
    { allParents: { nodes: [{ id: 1 }, { id: 2 }, { id: 3 }] } }
  )
);

test(
  "Includes only archived when EXCLUSIVELY",
  check(
    `{
      allParents(includeArchived: EXCLUSIVELY) {
        nodes {
          id
        }
      }
    }`,
    { allParents: { nodes: [{ id: 2 }] } }
  )
);
