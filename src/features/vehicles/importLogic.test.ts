import { describe, expect, it } from 'vitest';
import { checkPatente, formatPatente, normalizePatente } from '@/lib/patente';
import {
  autoMap,
  extractValues,
  matchCategory,
  parseInteger,
  parseStatus,
  toPayload,
  validateRows,
  type ImportRow,
} from '@/features/vehicles/importLogic';
import type { VehicleCategory } from '@/types/db';

const CATS: VehicleCategory[] = [
  { id: 'c1', name: 'Ford Ranger 2.2', brand: 'Ford', model: 'Ranger', version: '2.2', sort_order: 10, active: true },
  { id: 'c2', name: 'Ford Ranger 2.0', brand: 'Ford', model: 'Ranger', version: '2.0', sort_order: 20, active: true },
  { id: 'c3', name: 'Mercedes-Benz Sprinter 414', brand: 'Mercedes-Benz', model: 'Sprinter', version: '414', sort_order: 30, active: true },
  { id: 'c4', name: 'Minibuses', brand: null, model: null, version: null, sort_order: 80, active: true },
];

describe('Patentes', () => {
  it('normaliza mayúsculas y quita espacios/guiones', () => {
    expect(normalizePatente(' ab-123 cd ')).toBe('AB123CD');
    expect(normalizePatente('abc 123')).toBe('ABC123');
  });

  it('valida formatos argentinos estándar y especiales', () => {
    expect(checkPatente('AB123CD')).toEqual({ ok: true });
    expect(checkPatente('ABC123')).toEqual({ ok: true });
    expect(checkPatente('A1')).toEqual({ ok: false, error: 'La patente debe tener entre 5 y 10 caracteres' });
    expect(checkPatente('')).toEqual({ ok: false, error: 'La patente es obligatoria' });
    const special = checkPatente('PROV1234');
    expect(special.ok && special.warning).toBeTruthy();
  });

  it('formatea para lectura', () => {
    expect(formatPatente('AB123CD')).toBe('AB 123 CD');
    expect(formatPatente('ABC123')).toBe('ABC 123');
  });
});

describe('Importación Excel', () => {
  it('relaciona automáticamente columnas con distintos nombres', () => {
    const headers = [
      'Número de orden',
      'Dominio',
      'N° Interno',
      'Marca',
      'Modelo',
      'Año',
      'Chasis',
      'Motor',
      'Tipo de vehículo',
      'Medida de cubiertas',
      'Cantidad de cubiertas',
      'Kilometraje',
      'Estado',
    ];
    const m = autoMap(headers);
    expect(m.registro_nro).toBe(0);
    expect(m.patente).toBe(1);
    expect(m.nro_interno).toBe(2);
    expect(m.marca).toBe(3);
    expect(m.modelo).toBe(4);
    expect(m.anio).toBe(5);
    expect(m.chasis).toBe(6);
    expect(m.motor).toBe(7);
    expect(m.vehicle_type).toBe(8);
    expect(m.tire_type_size).toBe(9);
    expect(m.tire_count).toBe(10);
    expect(m.km_actual).toBe(11);
    expect(m.status).toBe(12);
  });

  it('interpreta números con separadores de miles y estados', () => {
    expect(parseInteger('125.400 km')).toBe(125400);
    expect(parseInteger('2022')).toBe(2022);
    expect(parseInteger('abc')).toBe('invalid');
    expect(parseStatus('Operativo')).toBe('operativo');
    expect(parseStatus('Fuera de servicio')).toBe('fuera_de_servicio');
    expect(parseStatus('En taller')).toBe('en_taller');
    expect(parseStatus('???')).toBe('invalid');
  });

  it('deduce la categoría desde marca/modelo/versión o tipo', () => {
    const base = extractValues([], {});
    expect(matchCategory({ ...base, marca: 'Ford', modelo: 'Ranger', version: '2.2' }, CATS)).toBe('c1');
    expect(matchCategory({ ...base, marca: 'Mercedes', modelo: 'Sprinter 414' }, CATS)).toBe('c3');
    expect(matchCategory({ ...base, vehicle_type: 'Minibús' }, CATS)).toBe('c4');
  });

  it('detecta patentes duplicadas en archivo y en base de datos, y registros incompletos', () => {
    const mapping = { patente: 0, marca: 1, modelo: 2, nro_interno: 3, anio: 4 };
    const raw = [
      ['AB123CD', 'Ford', 'Ranger', '10', '2021'],
      ['ab-123-cd', 'Ford', 'Ranger', '11', '2021'], // duplicada en el archivo
      ['EXIST01', 'Ford', 'Ranger', '12', '2021'], // ya existe en la BD
      ['AE999ZZ', '', '', '', ''], // incompleta (advertencia, pero válida)
    ];
    const baseRows: ImportRow[] = raw.map((r, i) => ({
      rowNumber: i + 2,
      values: extractValues(r, mapping),
      excluded: false,
      errors: [],
      warnings: [],
      dupInFile: false,
      existsInDb: false,
      categoryId: null,
      status: null,
    }));
    const existing = { patentes: new Set(['EXIST01']), internos: new Set<string>(), chasis: new Set<string>() };
    const validated = validateRows(baseRows, existing, CATS);

    expect(validated[0].dupInFile).toBe(true);
    expect(validated[1].dupInFile).toBe(true);
    expect(validated[2].existsInDb).toBe(true);
    expect(validated[2].errors).toContain('La patente ya existe en el sistema (no se duplicará)');
    expect(validated[3].errors).toHaveLength(0);
    expect(validated[3].warnings.some((w) => w.startsWith('Incompleto'))).toBe(true);

    // Si se excluye la fila repetida, la primera pasa a ser válida
    validated[1].excluded = true;
    const reval = validateRows(validated, existing, CATS);
    expect(reval[0].errors).toHaveLength(0);
    expect(toPayload(reval[0]).patente).toBe('AB123CD');
  });
});
