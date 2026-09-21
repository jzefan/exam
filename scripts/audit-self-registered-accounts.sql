-- 自注册账号排查（只读，不改任何数据）
--
-- 背景：/api/auth/register 原先没有角色白名单，学生点进注册页只能选「教学考试」，
-- 于是被开成 teacher 身份；注册还不带机构，后端会把人塞进第一个机构。
-- 现在接口只允许 teacher / evaluator，这份 SQL 用来清点此前的存量。
--
-- 依据：注册成功时 auth router 会写一条 activity_logs(event_category='auth',
-- event_type='register', user_id=新账号)。失败的注册会被回滚，所以这里看到的是
-- 「确实注册成功过」的账号。
--
-- 用法（Postgres）：
--   docker exec -i exam-db psql -U exam -d exam < scripts/audit-self-registered-accounts.sql

with self_registered as (
  select distinct on (al.user_id)
         al.user_id,
         al.created_at as registered_at,
         al.ip_address,
         al.user_agent
  from activity_logs al
  where al.event_category = 'auth'
    and al.event_type = 'register'
    and al.success
    and al.user_id is not null
  order by al.user_id, al.created_at
)
select
  u.username                                    as 账号,
  u.full_name                                   as 姓名,
  u.phone                                       as 手机号,
  u.student_id                                  as 学号,
  sr.registered_at                              as 注册时间,
  string_agg(distinct r.name, ', ')             as 角色,
  (select count(*) from classes c where c.created_by = u.id)  as 自建班级数,
  (select count(*) from exams e where e.created_by = u.id)    as 自建考试数,
  (select count(*) from teacher_students ts where ts.student_id = u.id) as 学生关系数,
  u.class_id is not null                        as 已分班,
  sr.ip_address                                 as 注册IP,
  case
    when exists (
      select 1 from user_organizations uo
      join roles r2 on r2.id = uo.role_id
      where uo.user_id = u.id and r2.name in ('student', 'assessee')
    ) then '已含学生身份，无需处理'
    when u.username ~ '^1[3-9][0-9]{9}$' then '手机号当用户名，疑似学生误注册'
    else '待人工确认'
  end                                           as 判断
from self_registered sr
join users u on u.id = sr.user_id
left join user_organizations uo on uo.user_id = u.id
left join roles r on r.id = uo.role_id
where u.deleted_at is null
group by u.id, u.username, u.full_name, u.phone, u.student_id,
         sr.registered_at, sr.ip_address, u.class_id
order by sr.registered_at desc;
