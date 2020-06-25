import gql from 'graphql-tag'

export interface MolecularDB {
  id: number
  name: string
  default: boolean
  hidden: boolean
}

export const createDatabaseQuery =
  gql`mutation ($input: CreateMolecularDBInput!) {
      createMolecularDB(databaseDetails: $input) {
        id
      }
  }`

export const databaseListItemsQuery =
  gql`query GetDatabases {
    molecularDatabases {
      id
      name
      version
      public
      archived
    }
  }`
