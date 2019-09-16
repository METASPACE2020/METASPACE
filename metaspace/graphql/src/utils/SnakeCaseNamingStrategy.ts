import { NamingStrategyInterface, DefaultNamingStrategy } from 'typeorm'
import { snakeCase } from 'typeorm/util/StringUtils'

export class SnakeCaseNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  tableName(className: string, userSpecifiedName: string | undefined): string {
    return userSpecifiedName ? userSpecifiedName : snakeCase(className)
  }

  columnName(propertyName: string, customName: string, embeddedPrefixes: string[]): string {
    return snakeCase(embeddedPrefixes.join('_')) + (customName ? customName : snakeCase(propertyName))
  }

  relationName(propertyName: string): string {
    return snakeCase(propertyName)
  }

  joinColumnName(relationName: string, referencedColumnName: string): string {
    return snakeCase(relationName + "_" + referencedColumnName)
  }

  joinTableName(firstTableName: string,
                secondTableName: string,
                firstPropertyName: string,
                secondPropertyName: string): string {
    return snakeCase(firstTableName + "_" + firstPropertyName.replace(/\./gi, "_") + "_" + secondTableName)
  }

  joinTableColumnName(tableName: string, propertyName: string, columnName?: string): string {
    return snakeCase(tableName + "_" + (columnName ? columnName : propertyName))
  }
}
