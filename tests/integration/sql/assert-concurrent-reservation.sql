do $$
begin
  if (select count(*) from public.budget_reservations where category = 'live_voice' and state = 'active') <> 1 then
    raise exception 'A35 failed: concurrent reservation count is not exactly one';
  end if;
end;
$$;

