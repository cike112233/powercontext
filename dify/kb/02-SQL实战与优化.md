## 分组与排名

### Q: 有张成绩表 sc(s_id 学号, c_id 课程号, score 分数),怎么查出每门课分数前三名的学生?
- 领域: 数据库
- 难度: 中级
- 考察点: 会不会用窗口函数做分组 Top-N,而不是自连接凑答案
- 参考答案要点: 8.0+ 用 select s_id, c_id, score from (select s_id, c_id, score, row_number() over (partition by c_id order by score desc) rn from sc) t where rn<=3;要允许并列名次且同分都取用 rank(),_dense_rank() 则名次连续不跳号;5.7 无窗口函数时只能用相关子查询 count 或变量模拟,效率与可读性都差;并列处理需和业务确认"第三名有 2 人要不要第 4 名补位",这决定了 rank 还是 row_number;数据量大时先按 c_id 过滤或加 (c_id, score) 联合索引让分区内已有序,避免 filesort
- 追问: rank 和 dense_rank 在 90/90/80 这门课上分别给什么名次?；如果要"每门课前 3 且总分不低于 250"该怎么加条件,窗口函数能不能直接写在 where 里?；5.7 上你怎么写?
- 评分标尺: 及格=写出正确 partition by + 外层过滤;良好=能区分三种排名函数语义并说明窗口函数不能在 where 中使用;优秀=给出索引配合与非并列业务歧义的确认
- 常见误区: 把窗口函数条件直接写进 where;以为 group by + limit 能取每组前 N

### Q: 登录日志表 login_log(user_id, login_date),怎么找出连续登录 3 天及以上的用户?
- 领域: 数据库
- 难度: 高级
- 考察点: 经典"连续区间"建模能力(gaps and islands)
- 参考答案要点: 先 select distinct user_id, login_date 去重(同一天多次登录要合并),否则连续判断被同日重复打断;核心技巧是 date_sub(login_date, interval rn day),rn 为该用户按 login_date 排序的 row_number(),同一连续段内该差值恒定,按 (user_id, diff) group by 即得每段,再 having count(*)>=3;若问最长连续天数则取 max(cnt);若问"是否存在连续 3 天"用 exists 或 group having 更省;数据量大时先按用户分区减少排序量,去重可用 (user_id, login_date) 唯一索引或松散索引扫描
- 追问: 为什么减去行号就能把连续日期归为同一组?；如果要求"连续 3 个自然日"改成"连续 3 次登录不超过 30 天"你怎么调整?；同一天多条记录不去重会出什么错?
- 评分标尺: 及格=想到 row_number 与日期差构造分组键;良好=强调 distinct 去重并能解释差值恒定的原因;优秀=能扩展到任意间隔规则(lag 求相邻差值再累计)并说明数据量下的索引与分区优化
- 常见误区: 直接 self join 判断 t+1、t+2(三天两次自连接,数据倾斜时爆炸);忘记同一天多次登录造成假连续

### Q: 表 student(name, subject, score) 存了语文数学英语三行,怎么查成一行三列的成绩单?
- 领域: 数据库
- 难度: 中级
- 考察点: 行转列(pivot)的手写能力,以及是否知道聚合函数的分工
- 参考答案要点: select name, max(case subject when '语文' then score end) as chinese, max(case subject when '数学' then score end) as math, max(case subject when '英语' then score end) as english from student group by name;必须套聚合函数,因为 group by 后每组多行,用 max 把非 null 的那一列挑出来,直接写 case 会报 only_full_group_by(5.7 起 sql_mode 默认开启);subject 可能缺考则用 ifnull(...,0),若希望缺考显示 null 就不能写 else 0,else 分支会影响 max 的结果;列不确定时靠程序动态拼 SQL,MySQL 本身无 pivot 语法;反向列转行用 union all 或 json_table
- 追问: 为什么不加 max 会报错,报错的具体信息是什么?；把 else 0 改成不写 else 结果有什么不同?；科目是配置表里动态增加的怎么办?
- 评分标尺: 及格=case when 写法正确;良好=解释聚合函数必要性与 ifnull/else 对结果的影响;优秀=能说明 sql_mode 配置、动态拼接的注入风险及列转行的对称写法
- 常见误区: 用 sum(case...) 时混入 else 0 导致平均分计算被拉低;忘记 group by 后 select 非聚合列

## 窗口函数与聚合

### Q: ROW_NUMBER、RANK、DENSE_RANK、LAG 这几个函数在使用上有什么区别和坑?
- 领域: 数据库
- 难度: 中级
- 考察点: 窗口函数的语义细节与常见误用
- 参考答案要点: ROW_NUMBER 严格唯一连续,同分也分出先后,order by 有并列时结果不确定,需要加次要排序键保证幂等;RANK 并列跳号(1,1,3),DENSE_RANK 并列不跳号(1,1,2);LAG/LEAD 取偏移行的值,默认偏移 1、默认值为 null、越界返回 default,可用于算环比 (score - lag_score)/lag_score,注意上一行是 null 时整个表达式为 null,需 ifnull 兜底;三者都必须有 over(order by ...) 才有序,over() 空括号则按全表无序;窗口函数在 select 阶段计算,所以不能出现在 where,只能套一层子查询过滤;frame 子句默认是 rows range unbounded preceding to current row,做累计求和时不写 frame 得到的是累计值而不是总和,这是最常见的坑
- 追问: 求每个用户的累计消费,order by 里日期有重复会出什么问题,怎么修?；lag 的第三个参数是干什么的?；sum() over 和 sum() group by 结果行数为什么不一样?
- 评分标尺: 及格=三种排名函数区别正确;良好=说清不能写在 where、需要子查询过滤;优秀=指出并列值下 range frame 导致的累计跳变,并用 rows between 修正
- 常见误区: 认为 rank 和 dense_rank 结果总一样;把窗口函数当聚合函数写进 having

### Q: 表 emp(id, name, dept_id, salary),怎么写 SQL 找出工资高于本部门平均工资的员工?
- 领域: 数据库
- 难度: 初级
- 考察点: 能否避开"聚合函数放 where"这个基础错误,并给出两种以上解法
- 参考答案要点: 错误写法是 where salary > avg(salary),聚合不能出现在 where(执行时分组尚未发生);解法一自连接:select e.name, e.salary, d.avg_s from emp e join (select dept_id, avg(salary) avg_s from emp group by dept_id) d on e.dept_id=d.dept_id where e.salary>d.avg_s;解法二相关子查询:where salary > (select avg(salary) from emp e2 where e2.dept_id=e.dept_id);解法三 8.0 窗口:select * from (select *, avg(salary) over (partition by dept_id) av from emp) t where salary>av;数据量大时优先解法一或三(避免每行执行子查询),相关子查询在 MySQL 上通常退化为逐行执行
- 追问: 三种写法在 5.7 和 8.0 上性能差异你怎么验证?；avg 要不要排除 null、要不要包含自己这一行?；如果"高于部门平均工资"改成"高于部门中位数"怎么写?
- 评分标尺: 及格=至少一种正确写法且知道 where 不能用聚合;良好=能比较三种写法复杂度并指出相关子查询代价;优秀=给出中位数/percentile 的处理思路和索引 (dept_id, salary) 的收益
- 常见误区: 直接 having 不加 group by 当过滤用;以为 avg 会忽略 dept_id 为 null 的分组逻辑

## JOIN、分页与批量写入

### Q: 表 orders(id, user_id, status, create_time),`limit 1000000, 20` 为什么慢,怎么优化?
- 领域: 数据库
- 难度: 高级
- 考察点: 深分页的真实代价与可落地的优化手段
- 参考答案要点: 慢的原因是 offset+n 行都要被扫描、回表、构造再丢弃,100 万偏移意味着引擎层要读并丢弃约 100 万行,网络与 buffer pool 都被浪费;优化一"延迟关联/书签表":select o.* from orders o join (select id from orders order by id limit 1000000,20) t on o.id=t.id,内层只扫覆盖索引不回表;优化二游标分页(推荐):where id > 上次最后一条 id order by id limit 20,代价恒定为 O(n),但不支持随机跳页;优化三按 create_time+id 复合游标保证排序唯一;优化四业务侧限制最大可翻页数或改搜索条件、必要时走 ES;count 总数另做异步统计避免每次带 sql_calc_found_rows
- 追问: 延迟关联为什么能减少回表,EXPLAIN 上会看到什么变化?；游标分页在排序列有重复值时怎么处理?；offset 是 0 和 offset 很大时,优化器行为有区别吗?
- 评分标尺: 及格=答到扫描并丢弃 offset 行;良好=给出延迟关联和游标分页两种方案及适用条件;优秀=说明覆盖索引、排序唯一性与随机跳页取舍,并提到业务侧限页
- 常见误区: 认为加索引就能让大 offset 变快;把 limit 交给 ORM 的 page 参数而不评估量级

### Q: 三张表 user_info、orders、order_item 做联查,JOIN 顺序和驱动表该怎么定?
- 领域: 数据库
- 难度: 高级
- 考察点: 优化器的 join 选择逻辑,而不是背"小表驱动大表"
- 参考答案要点: MySQL 优化器固定用 left-deep 方式:FROM 里的表顺序会被按 cost 重新排列(可用 straight_join 强制),驱动表选"经过 where 过滤后估算扫描行数最少"的那张,而不是表物理大小最少;原则是让被驱动表的关联列有索引,避免 Nested-Loop 变成 M×N;8.0.18 起无索引时可用 hash join(EXPLAIN 显示 Using join buffer (hash join)),5.7 只有 BNL,会把被驱动表整表读进 join_buffer(默认 256KB,可调 join_buffer_size),代价极高;等值 join 列的类型与字符集 collation 必须一致,否则索引失效;关联条件尽量写成能利用索引的形式,join 顺序不对时可用 EXPLAIN 看谁在 Extra 里出现 Using join buffer
- 追问: 为什么"小表驱动大表"这句话在 MySQL 里不完全对?；join_buffer_size 调大能替代索引吗?；collation 不一致时报什么、怎么改?
- 评分标尺: 及格=答到被驱动表关联列要有索引;良好=能说出优化器按过滤后行数和 cost 重排、straight_join 与 EXPLAIN 判断依据;优秀=区分 BNL 与 8.0 hash join、说明 collation 不一致导致索引不可用
- 常见误区: 认为写 SQL 时把小表放前面就一定更优;把 join buffer 当性能开关盲目调大

### Q: 查询里用 `where id in (select ...)` 和 `where exists (...)` 有什么区别,什么时候必须改写成 JOIN?
- 领域: 数据库
- 难度: 中级
- 考察点: 子查询的物化/半连接执行方式,能否量化差异
- 参考答案要点: 非相关 in 子查询在 8.0 通常被优化为 semi-join(EXPLAIN Extra 见 Using where; With subquery materialization 或 Use IN(index lookup)),子查询结果物化成临时表并建哈希,执行一次;相关子查询 exists 对每行外层记录都执行一次,若外层 10 万行就是 10 万次内层查询,复杂度 O(M×N);exists 语义对 null 安全,in 子查询若返回列含 null 会导致整体不匹配的风险(尤其与 not in 组合时,not in 含 null 直接返回空集,not exists 才是正确写法);需要取子查询表的字段时必须改 join;改 join 时要警惕一对多导致结果行数膨胀,可用 join (select distinct ...) 或 exists 保持原语义
- 追问: not in 和 not exists 在子查询列有 null 时结果为什么不同?；改成 join 后行数变多怎么办?；怎么从执行计划确认 in 子查询被物化?
- 评分标尺: 及格=答到 exists 是相关子查询、可短路;良好=讲清 semi-join 与物化、not in 的 null 陷阱;优秀=强调改写需保持基数不变并给出 distinct/半连接验证方法
- 常见误区: 绝对化说"exists 一定比 in 快";用 join 替代 exists 却造成结果重复行

### Q: 标签表 user_tag(user_id, tag, updated_at),唯一键 uk(user_id, tag),怎么高效写入几百万条并支持"存在则更新"?
- 领域: 数据库
- 难度: 中级
- 考察点: 批量写入与幂等更新的实际写法与参数
- 参考答案要点: 幂等更新用 insert into user_tag(user_id,tag,updated_at) values (...) on duplicate key update updated_at=values(updated_at)(8.0.20 起官方推荐用 new 表别名写法取代 values(),弃用警告);affected rows 语义:插入返回 1、更新返回 2、命中但值未变返回 0,不能拿它当"写了几条"直接算;纯新增不去重场景用 insert ignore(会吞掉所有约束错误并占自增 id);真正批量要一条语句多组 values,客户端 JDBC 必须加 rewriteBatchedStatements=true 否则仍是逐条往返,单批 500~1000 行为宜,过大受 max_allowed_packet(默认 64MB)限制且长事务放大 undo 与主从延迟;大批量导入临时关唯一校验不现实,应分批提交并设置 innodb_flush_log_at_trx_commit=2 权衡
- 追问: on duplicate key 和 replace into 的本质区别是什么?；为什么 replace 会引发自增 id 变化和 binlog 膨胀?；批量插入时死锁是怎么产生的?
- 评分标尺: 及格=正确写出 upsert 语法;良好=给出 affected rows 语义、rewriteBatchedStatements 与批量大小依据;优秀=能解释 replace 是删除重插、锁范围更大、批量并发插入间隙锁死锁的成因与重试
- 常见误区: 用 replace into 当 upsert;认为 executeBatch 不需要驱动参数就会自动合并语句

## 日期、去重与语义

### Q: 统计某月订单,写了 `where date_format(create_time,'%Y-%m')='2026-10'`,为什么走不了索引,该怎么改?
- 领域: 数据库
- 难度: 中级
- 考察点: 表达式使索引失效的原理与 sargable 改写
- 参考答案要点: 对索引列套函数后,列值不再是有序可二分的结构,优化器无法用它做区间定位,只能全表/全索引扫描;正确写法是把列单独放一侧、常量放另一侧:where create_time>='2026-10-01 00:00:00' and create_time<'2026-11-01 00:00:00',这是半开区间,能命中 create_time 上的 B+树范围扫描;用 between '2026-10-01' and '2026-10-31' 会漏掉 10-31 当天带时分秒的记录,这是典型 bug;要按天/月分组时可以在 select 里用 date(create_time) 分组(排序发生在过滤之后不影响索引),或者建函数索引/生成列(MySQL 8.0.13 generated column + index on (date(create_time)))直接按天聚合;时区与列类型(datetime vs timestamp)会影响边界
- 追问: 8.0 的函数索引怎么建,和生成列索引有什么区别?；select 里用 date(create_time) 会不会让 where 的索引失效?；between 的边界坑你踩过吗?
- 评分标尺: 及格=答到列上套函数导致失效并改成范围条件;良好=指出 between 漏记录与半开区间写法;优秀=给出函数索引/生成列方案并区分 where 表达式与 select 分组表达式的不同影响
- 常见误区: 改成 create_time like '2026-10%' 之类;认为只要索引存在,函数包裹也能走 range

### Q: 表 order_dup(id, order_no, amount, created_at) 有重复 order_no,怎么只保留 id 最大的一条把其余删掉?
- 领域: 数据库
- 难度: 中级
- 考察点: 数据清洗的实际 SQL 能力,以及对锁和回滚的考虑
- 参考答案要点: 查冲突用 select order_no from order_dup group by order_no having count(*)>1;删除用窗口函数定位:delete t from order_dup t join (select id, row_number() over (partition by order_no order by id desc) rn from order_dup) d on t.id=d.id and d.rn>1(8.0;5.7 可用 self join 保留 max(id));也可 delete a from order_dup a join order_dup b on a.order_no=b.order_no and a.id<b.id,注意它可能产生多行匹配但 MySQL 单表 delete join 只按目标表统计,删除结果仍正确;先去重再建 unique key uk(order_no) 才是根治,否则还会脏回来;两亿行时该操作是长事务,应分批(limit 分批或按 id 区间)并监控 undo 膨胀与主从延迟;先备份或用影子表重建更快
- 追问: 为什么建唯一索引前必须先清脏数据,直接建会怎样?；分批删除怎么写才高效?；保留最小 id 还是最大 id 有什么业务讲究?
- 评分标尺: 及格=能写出正确的自连接/窗口定位;良好=强调后续唯一索引与根治;优秀=给出分批、影子表重建与复制延迟的风险控制
- 常见误区: 用 delete ... group by(语法不合法/依赖 ONLY_FULL_GROUP_BY);只删数据不加唯一约束

### Q: HAVING 和 WHERE 的分工是什么,SQL 的执行顺序是怎样的?
- 领域: 数据库
- 难度: 初级
- 考察点: 基础语意是否清楚,能否用执行顺序解释写法选择
- 参考答案要点: 执行顺序:from→join→on→where→group by→聚合(window/aggregate)→having→select→distinct→order by→limit;where 在分组前过滤原始行,不能引用聚合结果和 select 别名(标准 SQL 下,having 可用别名是 MySQL 扩展);having 在分组后过滤组,适合 count/sum 条件如 having count(*)>3;能在 where 做的过滤一定放 where,先减少参与分组与临时表的行数,少一次物化;聚合上界的 min/max 也能放 where 但改写要保持语义;order by 可引用 select 别名,limit 最后生效所以"先排序再截断";性能上 having 里可写 filter 思路但 MySQL 无 filter 子句,可用条件聚合 sum(x='a') 代替
- 追问: 为什么 where 里不能用 sum(salary)?；having 的过滤能不能全部下推到 where,什么情况下不行?；distinct 和 group by 谁先执行,性能有差别吗?
- 评分标尺: 及格=答到分组前/分组后过滤;良好=能背出正确执行顺序并解释别名可用性问题;优秀=指出尽早过滤降低临时表与 filesort 的量,并说明 MySQL 对 distinct/group by 的等价处理
- 常见误区: 认为 having 一定比 where 慢是语法决定的(本质是过滤时机);在 where 里写聚合条件

### Q: 分页接口既要返回总数又要返回列表,`select count(*)` 每次很慢,你有什么办法?
- 领域: 数据库
- 难度: 高级
- 考察点: 工程权衡,是否知道用近似值与缓存换性能
- 参考答案要点: 先量化:count(*) 在 InnoDB 需扫最小可用索引统计可见行,亿级表上就是几十万次页读,不能靠缓存精确值;方案一 sql_calc_found_rows + select found_rows() 让同一次查询带回总数,但它仍需扫描全量匹配行,只省一次往返不省时间;方案二按查询条件维度做计数缓存(Redis/计数表,TTL 60 秒,业务能接受最终一致),配合"只展示总数到某档位如 1000+";方案三前端改游标翻页、去掉总数;方案四近似统计:explain 里的 rows 或 information_schema.tables 的 table_rows(误差按采样,约 10% 量级)取整展示;方案五把 count 与数据查询拆异步,count 走只读从库或走 ES 聚合
- 追问: sql_calc_found_rows 有什么隐藏代价?；为什么 InnoDB 不缓存 count(*)?；table_rows 的误差从哪来?
- 评分标尺: 及格=知道 count 慢的根本原因;良好=给出缓存/游标/异步三类方案与一致性代价;优秀=能解释 MVCC 可见性使精确 count 无法缓存、并说明抽样统计误差来源
- 常见误区: 以为 select count(*) 加索引列(如 id)会更快很多;用 sql_calc_found_rows 当性能优化而不评估扫描量
