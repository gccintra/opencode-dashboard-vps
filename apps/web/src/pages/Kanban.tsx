import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { KanbanBoard, type KanbanFiltersState } from '../components/KanbanBoard';

/** Parse URL search params into filter state */
function filtersFromParams(params: URLSearchParams): KanbanFiltersState {
  const projectParam = params.get('project') || '';
  const labelParam = params.get('label') || '';
  const typeParam = params.get('type') || 'all';
  const queryParam = params.get('q') || '';
  const sortParam = params.get('sort') || 'manual';

  return {
    projectIds: projectParam ? projectParam.split(',').filter(Boolean) : [],
    labelIds: labelParam ? labelParam.split(',').filter(Boolean) : [],
    type: ['all', 'task', 'issue'].includes(typeParam) ? typeParam : 'all',
    query: queryParam,
    sort: ['manual', 'created', 'updated'].includes(sortParam) ? sortParam : 'manual',
  };
}

/** Convert filter state to URL search params */
function filtersToUrl(filters: KanbanFiltersState): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.projectIds.length > 0) {
    params.set('project', filters.projectIds.join(','));
  }
  if (filters.labelIds.length > 0) {
    params.set('label', filters.labelIds.join(','));
  }
  if (filters.type !== 'all') {
    params.set('type', filters.type);
  }
  if (filters.query.trim()) {
    params.set('q', filters.query.trim());
  }
  if (filters.sort !== 'manual') {
    params.set('sort', filters.sort);
  }
  return params;
}

export default function KanbanPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialFilters = filtersFromParams(searchParams);

  const handleFiltersChange = useCallback(
    (filters: KanbanFiltersState) => {
      const next = filtersToUrl(filters);
      setSearchParams(next, { replace: true });
    },
    [setSearchParams],
  );

  return <KanbanBoard initialFilters={initialFilters} onFiltersChange={handleFiltersChange} />;
}
