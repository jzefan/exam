"""Refine-compatible pagination, sorting, and filtering utilities.

Refine's simple-rest data provider sends:
  - Pagination: _start, _end
  - Sorting: _sort, _order
  - Filtering: field=value or field_operator=value (e.g., title_like=foo)
"""

from dataclasses import dataclass

from fastapi import Query, Request
from sqlalchemy import Select, asc, desc, func
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(frozen=True)
class PaginationParams:
    offset: int
    limit: int
    sort_by: str | None
    sort_order: str


def parse_pagination(
    _start: int = Query(0, alias="_start"),
    _end: int = Query(10, alias="_end"),
    _sort: str | None = Query(None, alias="_sort"),
    _order: str = Query("ASC", alias="_order"),
) -> PaginationParams:
    return PaginationParams(offset=_start, limit=_end - _start, sort_by=_sort, sort_order=_order)


def apply_pagination(query: Select, params: PaginationParams, model: type) -> Select:
    if params.sort_by and hasattr(model, params.sort_by):
        column = getattr(model, params.sort_by)
        order_fn = desc if params.sort_order.upper() == "DESC" else asc
        query = query.order_by(order_fn(column))

    return query.offset(params.offset).limit(params.limit)


def parse_filters(request: Request, model: type) -> dict:
    """Extract Refine-style filters from query params, ignoring pagination params."""
    skip_keys = {"_start", "_end", "_sort", "_order"}
    filters = {}
    for key, value in request.query_params.items():
        if key in skip_keys:
            continue
        filters[key] = value
    return filters


def apply_filters(query: Select, filters: dict, model: type) -> Select:
    """Apply simple equality filters. Supports field_operator suffix for advanced ops."""
    for key, value in filters.items():
        # Handle operator suffixes like field_like, field_gte, field_in, etc.
        if "_like" in key:
            field_name = key.replace("_like", "")
            if hasattr(model, field_name):
                query = query.where(getattr(model, field_name).ilike(f"%{value}%"))
        elif "_in" in key:
            field_name = key.replace("_in", "")
            if hasattr(model, field_name):
                raw_values = [v.strip() for v in value.split(",") if v.strip()]
                if raw_values:
                    # Cast to int if the column is numeric
                    col = getattr(model, field_name)
                    col_type = str(col.type)
                    if col_type.startswith("INTEGER") or col_type.startswith("FLOAT"):
                        try:
                            raw_values = [int(v) for v in raw_values]
                        except ValueError:
                            pass
                    query = query.where(col.in_(raw_values))
        elif "_gte" in key:
            field_name = key.replace("_gte", "")
            if hasattr(model, field_name):
                query = query.where(getattr(model, field_name) >= value)
        elif "_lte" in key:
            field_name = key.replace("_lte", "")
            if hasattr(model, field_name):
                query = query.where(getattr(model, field_name) <= value)
        elif hasattr(model, key):
            query = query.where(getattr(model, key) == value)
    return query


async def get_total_count(db: AsyncSession, query: Select) -> int:
    count_query = query.with_only_columns(func.count()).order_by(None)
    result = await db.execute(count_query)
    return result.scalar_one()
