import {Column, Entity, Index, ManyToOne, OneToMany, PrimaryColumn, PrimaryGeneratedColumn} from "typeorm";


@Entity({ schema: 'public', name: 'molecular_db' })
export class MolecularDB {

  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text' })
  version: string;

  @OneToMany(type => Molecule, molecule => molecule.moldb)
  molecules: Molecule[];

  // TODO: add unique constraint (group_id, name, version)
}

@Entity({ schema: 'public' })
export class Molecule {

    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'text' })
    molId: string;

    @Column({ type: 'text' })
    molName: string;

    @Column({ type: 'text' })
    formula: string;

    @Column({ type: 'text', nullable: true })
    inchi: string;

    @Index()
    @Column({ type: 'int'})
    moldbId: number;

    @ManyToOne(type => MolecularDB)
    moldb: MolecularDB;
}

export const MOLECULAR_DB_ENTITIES = [
  MolecularDB,
  Molecule,
];