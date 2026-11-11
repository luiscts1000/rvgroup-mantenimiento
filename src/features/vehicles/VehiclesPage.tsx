import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Upload, Download, Search, ArrowUpDown, ChevronLeft, ChevronRight, Pencil, Eye, FilterX, QrCode } from 'lucide-react';
import { Badge, Button, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { STATUS_COLORS, STATUS_DOT, STATUS_LABELS } from '@/lib/constants';
import { formatPatente } from '@/lib/patente';
import { formatNumber, slug } from '@/lib/utils';
import type { Vehicle, VehicleStatus } from '@/types/db';
import { useCategories, useVehicles } from './api';
import { VehicleFormModal } from './VehicleFormModal';
import { exportVehiclesToExcel } from './exportExcel';
import { VehicleQrModal } from './VehicleQrModal';

type SortKey = 'patente' | 'nro_interno' | 'marca' | 'anio' | 'km_actual' | 'status' | 'category';
const PAGE_SIZE = 25;

export function StatusBadge({ status }: { status: VehicleStatus }) {
  return (
    <Badge className={STATUS_COLORS[status]} dot={STATUS_DOT[status]}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export function DemoBadge() {
  return <Badge className="bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-300">DEMO</Badge>;
}

export function VehiclesPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data: vehicles = [], isLoading, error } = useVehicles();
  const { data: categories = [] } = useCategories();

  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'activas' | 'todas' | VehicleStatus>('activas');
  const [categoryId, setCategoryId] = useState('');
  const [marca, setMarca] = useState('');
  const [tipo, setTipo] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'patente', dir: 1 });
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [qrVehicle, setQrVehicle] = useState<Vehicle | null>(null);

  const marcas = useMemo(() => [...new Set(vehicles.map((v) => v.marca).filter(Boolean))].sort() as string[], [vehicles]);
  const tipos = useMemo(() => [...new Set(vehicles.map((v) => v.vehicle_type).filter(Boolean))].sort() as string[], [vehicles]);

  const filtered = useMemo(() => {
    const term = slug(q);
    const list = vehicles.filter((v) => {
      if (status === 'activas' && v.status === 'baja') return false;
      if (status !== 'activas' && status !== 'todas' && v.status !== status) return false;
      if (categoryId && (categoryId === '__none' ? v.category_id : v.category_id !== categoryId)) return false;
      if (marca && v.marca !== marca) return false;
      if (tipo && v.vehicle_type !== tipo) return false;
      if (term) {
        const hay = slug(
          [v.patente, v.nro_interno, v.marca, v.modelo, v.version, v.chasis, v.motor, v.registro_nro, v.vehicle_categories?.name].join(' '),
        );
        if (!hay.includes(term)) return false;
      }
      return true;
    });
    const val = (v: Vehicle): string | number => {
      switch (sort.key) {
        case 'category':
          return v.vehicle_categories?.name ?? '';
        case 'anio':
          return v.anio ?? 0;
        case 'km_actual':
          return v.km_actual ?? 0;
        case 'nro_interno':
          return v.nro_interno?.padStart(10, '0') ?? '';
        default:
          return (v[sort.key] ?? '') as string;
      }
    };
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [vehicles, q, status, categoryId, marca, tipo, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const pageRows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const hasFilters = q || status !== 'activas' || categoryId || marca || tipo;

  const toggleSort = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }));
  const resetFilters = () => {
    setQ('');
    setStatus('activas');
    setCategoryId('');
    setMarca('');
    setTipo('');
    setPage(1);
  };

  const Th = ({ k, children }: { k: SortKey; children: string }) => (
    <th>
      <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 uppercase hover:text-brand-700">
        {children}
        <ArrowUpDown className={`h-3 w-3 ${sort.key === k ? 'text-brand-600' : 'opacity-40'}`} />
      </button>
    </th>
  );

  return (
    <div>
      <PageHeader
        title="Unidades de RV Group"
        subtitle={`${formatNumber(filtered.length)} de ${formatNumber(vehicles.length)} unidades`}
        actions={
          <>
            {can('vehicles', 'export') && (
              <Button
                variant="secondary"
                icon={<Download className="h-4 w-4" />}
                disabled={!filtered.length}
                onClick={() => exportVehiclesToExcel(filtered, hasFilters ? '_filtrado' : '')}
              >
                Exportar Excel
              </Button>
            )}
            {can('vehicles', 'create') && (
              <>
                <Button variant="secondary" icon={<Upload className="h-4 w-4" />} onClick={() => navigate('/unidades/importar')}>
                  Importar Excel
                </Button>
                <Button
                  icon={<Plus className="h-4 w-4" />}
                  onClick={() => {
                    setEditing(null);
                    setFormOpen(true);
                  }}
                >
                  Nueva unidad
                </Button>
              </>
            )}
          </>
        }
      />

      {/* Buscador y filtros */}
      <div className="card mb-4 grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Buscar patente, interno, marca, chasis…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <select className="input" value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }}>
          <option value="activas">Activas (sin bajas)</option>
          <option value="todas">Todas</option>
          {(Object.keys(STATUS_LABELS) as VehicleStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select className="input" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }}>
          <option value="">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="__none">Sin categoría</option>
        </select>
        <select className="input" value={marca} onChange={(e) => { setMarca(e.target.value); setPage(1); }}>
          <option value="">Todas las marcas</option>
          {marcas.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <div className="flex gap-2">
          <select className="input" value={tipo} onChange={(e) => { setTipo(e.target.value); setPage(1); }}>
            <option value="">Todos los tipos</option>
            {tipos.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          {hasFilters && (
            <Button variant="ghost" onClick={resetFilters} title="Limpiar filtros" className="px-2">
              <FilterX className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <Spinner />
        ) : error ? (
          <EmptyState title="No se pudieron cargar las unidades" description={(error as Error).message} />
        ) : !filtered.length ? (
          <EmptyState
            title={vehicles.length ? 'No hay unidades que coincidan con los filtros' : 'Todavía no hay unidades registradas'}
            description={vehicles.length ? undefined : 'Cargue la flota desde un Excel o agregue unidades individualmente.'}
            action={
              vehicles.length ? (
                <Button variant="secondary" onClick={resetFilters}>
                  Limpiar filtros
                </Button>
              ) : can('vehicles', 'create') ? (
                <Button icon={<Upload className="h-4 w-4" />} onClick={() => navigate('/unidades/importar')}>
                  Importar desde Excel
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Tabla (pantallas medianas y grandes) */}
            <div className="hidden overflow-x-auto md:block">
              <table className="table-base">
                <thead>
                  <tr>
                    <Th k="patente">Patente</Th>
                    <Th k="nro_interno">Interno</Th>
                    <Th k="category">Categoría</Th>
                    <Th k="marca">Marca / Modelo</Th>
                    <Th k="anio">Año</Th>
                    <Th k="km_actual">Km</Th>
                    <th>Cubiertas</th>
                    <Th k="status">Estado</Th>
                    <th className="text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {pageRows.map((v) => (
                    <tr
                      key={v.id}
                      className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      onClick={() => navigate(`/unidades/${v.id}`)}
                    >
                      <td>
                        <span className="font-mono font-semibold text-slate-900 dark:text-white">{formatPatente(v.patente)}</span>
                        {v.is_demo && <span className="ml-2"><DemoBadge /></span>}
                      </td>
                      <td>{v.nro_interno ?? '—'}</td>
                      <td className="max-w-[200px] truncate">{v.vehicle_categories?.name ?? <span className="text-slate-400">—</span>}</td>
                      <td>
                        {[v.marca, v.modelo, v.version].filter(Boolean).join(' ') || <span className="text-slate-400">—</span>}
                      </td>
                      <td>{v.anio ?? '—'}</td>
                      <td>{formatNumber(v.km_actual)}</td>
                      <td>{v.tire_count ? `${v.tire_count} × ${v.tire_type_size ?? '?'}` : v.tire_type_size ?? '—'}</td>
                      <td>
                        <StatusBadge status={v.status} />
                      </td>
                      <td className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" title="Generar / Imprimir QR" onClick={() => setQrVehicle(v)}>
                            <QrCode className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                          </Button>
                          <Button size="sm" variant="ghost" title="Ver ficha" onClick={() => navigate(`/unidades/${v.id}`)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          {can('vehicles', 'edit') && (
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Editar"
                              onClick={() => {
                                setEditing(v);
                                setFormOpen(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Tarjetas (celulares) */}
            <div className="divide-y divide-slate-100 dark:divide-slate-800 md:hidden">
              {pageRows.map((v) => (
                <button
                  key={v.id}
                  onClick={() => navigate(`/unidades/${v.id}`)}
                  className="flex w-full items-start justify-between gap-3 p-4 text-left active:bg-slate-50 dark:active:bg-slate-800"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-base font-bold text-slate-900 dark:text-white">
                      {formatPatente(v.patente)}
                      {v.nro_interno && <span className="ml-2 font-sans text-sm font-normal text-slate-500">Int. {v.nro_interno}</span>}
                    </p>
                    <p className="truncate text-sm text-slate-600 dark:text-slate-300">
                      {[v.marca, v.modelo, v.version].filter(Boolean).join(' ') || v.vehicle_categories?.name || 'Sin datos de modelo'}
                    </p>
                    <p className="text-xs text-slate-400">
                      {v.anio ?? 's/año'} · {v.km_actual != null ? `${formatNumber(v.km_actual)} km` : 's/km'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge status={v.status} />
                    {v.is_demo && <DemoBadge />}
                  </div>
                </button>
              ))}
            </div>

            {/* Paginación */}
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm dark:border-slate-800">
              <span className="text-slate-500">
                {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, filtered.length)} de {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="secondary" disabled={current <= 1} onClick={() => setPage(current - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-2 text-slate-600 dark:text-slate-300">
                  {current} / {pages}
                </span>
                <Button size="sm" variant="secondary" disabled={current >= pages} onClick={() => setPage(current + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <VehicleFormModal open={formOpen} onClose={() => setFormOpen(false)} vehicle={editing} />
      <VehicleQrModal open={qrVehicle !== null} onClose={() => setQrVehicle(null)} vehicle={qrVehicle} />
    </div>
  );
}
