## 索引与存储结构

### Q: 索引为什么用 B+树,不用红黑树或者普通的 B树?
- 领域: 数据库
- 难度: 中级
- 考察点: 能否从磁盘 I/O 模型出发讲清数据结构的取舍,而不是背"平衡所以快"
- 参考答案要点: 红黑树是二叉树,千万级数据高度约 20 层,每层一次随机 I/O,且节点规模小不适合按页落盘;B树非叶子节点也存 data,同样 16KB 页里能容纳的 key 更少、树更高,B+树非叶节点只存 key+页号,按一行 1KB、内部节点约 1170 个分支估算,三层可索引 1170×1170×16≈2000 万行,根节点常驻内存后一次查询实际 2 次磁盘读;B+树叶子节点用双向链表串起,范围查询和 order by 顺序扫描不需要中序回溯;所有查询都终止在叶子层,代价稳定为 O(log n) 且层数即 I/O 次数
- 追问: 三层 B+树大概能放多少行,这个数怎么估出来的?；如果一行从 1KB 膨胀到 8KB,树高和查询 I/O 会怎么变?；InnoDB 为什么不把哈希索引做成默认,MEMORY 引擎的哈希索引遇到大量重复 key 会怎样?
- 评分标尺: 及格=答到减少磁盘随机 I/O 与树高;良好=给出 16KB 页和约两千万行的量级;优秀=能讲清叶子链表对 range scan 的意义,并指出哈希索引不支持范围查询与最左前缀
- 常见误区: 只说"B+树是平衡树所以快";把 B树和 B+树的区别说成"一个平衡一个不平衡"

### Q: 什么是聚簇索引和回表,二级索引查数据为什么要回表?
- 领域: 数据库
- 难度: 初级
- 考察点: 是否真正理解 InnoDB 索引的物理组织方式
- 参考答案要点: 聚簇索引的叶子节点直接存放完整行,InnoDB 一张表只有一份,优先选主键,没主键用第一个非空唯一索引,再没有就隐式生成 6 字节 row_id;二级索引叶子存的是"索引列 + 主键值",因此先在主键 B+树上定位到主键值,再到聚簇索引树按主键查找完整行,这一趟二次查找就是回表;回表是主键树上的独立查找,单次约 2~3 页 I/O,二级索引命中 N 行就最多 N 次随机 I/O,这是"走索引却比全表扫描慢"的主因;MyISAM 的索引叶子存行地址,主键与普通索引同为非聚簇设计
- 追问: 为什么二级索引里存的"回表指针"是主键而不是行地址?；表没有显式主键时 InnoDB 怎么选聚簇索引?；MyISAM 和 InnoDB 在索引结构上最本质的差别是什么?
- 评分标尺: 及格=说清聚簇索引叶子存整行、二级索引存主键;良好=能解释回表的 I/O 代价与行数放大关系;优秀=进一步说明用主键做回表指针可避免行迁移/页分裂后指针失效
- 常见误区: 认为一张表可以有多个聚簇索引;把回表说成"从磁盘读表结构"

### Q: 覆盖索引是什么,怎么判断一条 SQL 用上了覆盖索引?
- 领域: 数据库
- 难度: 中级
- 考察点: 会不会用 EXPLAIN 验证优化手段,而不是只会说概念
- 参考答案要点: 查询需要的列全部包含在某个二级索引中,引擎在索引叶子就能取到数据,无需回表,这叫覆盖索引;判断依据是 EXPLAIN 的 Extra 出现 Using index,而只避免部分回表(索引下推)是 Using index condition;典型写法是把 select * 改成显式列,再建 (a,b,include_col) 联合索引把常用查询列放进索引尾部;联合索引的"值列"要放在检索列之后,否则列宽变大、单页能放的 key 变少、树高上升;主键列天然被所有二级索引携带,所以按主键查全字段的场景不需要额外做覆盖;代价是写放大和空间放大,一个宽覆盖索引会让一次 insert 多写若干页
- 追问: Using index 和 Using index condition 有什么区别?；为什么不推荐用覆盖索引把 20 个大字段都塞进联合索引?；count(*) 和 count(1) 在覆盖索引上是怎么被优化的?
- 评分标尺: 及格=答到不用回表 + Using index;良好=能区分 Using index / Using index condition / Using index materialization;优秀=指出覆盖索引的写放大代价及主键列被隐式携带
- 常见误区: 把"走了索引"等同于"用了覆盖索引";认为覆盖索引可以无条件多建

### Q: 最左前缀原则是什么意思,联合索引 (a,b,c) 为什么查询 b 用不上?
- 领域: 数据库
- 难度: 中级
- 考察点: 对联合索引排序规则和 optimizer 行为的理解深度
- 参考答案要点: 联合索引按 a 排序,a 相同按 b 排序,b 相同按 c 排序,只有从最左列开始连续使用才能保证有序可二分,跳过 a 直接按 b 过滤时 b 在全局是乱序的;等值命中列之后遇到 range 条件,range 之后的列不再用于精确定位,例如 a=1 and b>2 and c=3 中只有 (a,b) 参与索引扫描,c 需要靠 ICP 在索引层过滤;MySQL 8.0.13 起有 index skip scan,当最左列基数很低(如只有 male/female)时可跳过最左列,EXPLAIN 显示 Using index skip scan;等值列表顺序无关,优化器会重排 b=2 and a=1 为 (a,b);范围条件写对最左前缀长度可用 key_len 校验
- 追问: key_len 怎么算出联合索引实际用了几列?；a=1 and b>2 and c=3 里 c 完全没用吗,MySQL 有没有办法在索引层过滤它?；把联合索引顺序改成 (b,a,c) 原来的查询还能命中吗?
- 评分标尺: 及格=答到索引按列顺序排序、必须从最左列开始;良好=讲清 range 之后列失效 + 用 key_len 验证;优秀=能提到 skip scan 的适用条件(低基数)与 ICP 的配合
- 常见误区: 认为 where 里出现联合索引任意列就能命中;把"顺序无关"错误推广到跨列跳用

### Q: 哪些写法会导致索引失效,你在项目里踩过哪些坑?
- 领域: 数据库
- 难度: 中级
- 考察点: 实战经验 + 对 optimizer 成本判断的理解
- 参考答案要点: 对索引列做函数或运算,如 date(create_time)='2026-10-01'、id+1=10,应改成列单独出现在一侧的范围写法;隐式类型转换,varchar 列写 where phone=13800000000 会把列做 CAST 使索引不可用(varchar→int 才失效,int 列传字符串只截断仍可用);前导 % 的 like '%xx',后置 % 可走索引;or 连接非同一索引的列;在低区分度列(如 status 只有 3 个值)上优化器按成本估算认为回表比全表扫贵,主动放弃索引,可用 force index 验证;联合索引不满足最左前缀;not in / <> / is not null 通常退化为扫描;字符集或 collation 不一致的关联列
- 追问: 为什么 int 列传字符串还能用索引,varchar 列传数字就不能?；优化器基于什么统计信息决定放弃索引,rows 估不准时怎么办?；like '%关键字%' 业务上必须做,你有什么替代方案?
- 评分标尺: 及格=能列 3 类以上失效写法;良好=区分"语法上不可用"和"成本上被放弃";优秀=给出 collation 不一致、优化器成本估算与全文索引/ES 的替代路径
- 常见误区: 说"用函数一定不走索引"(优化器对部分表达式有处理);认为 index 一定比全表快

## SQL 执行计划与事务

### Q: EXPLAIN 里你主要看哪几个字段,分别怎么判断?
- 领域: 数据库
- 难度: 中级
- 考察点: 是否真读过执行计划,能定量评估一条 SQL
- 参考答案要点: type 反映访问方式,优劣顺序大致 const > eq_ref > ref > range > index > ALL,index 是全扫二级索引(仍比 ALL 少读列),低于 range 就要警惕;key 是实际使用的索引,key_len 用来反推用了几列(varchar(20) utf8mb4 是 20×4+2+1);rows 是优化器按索引统计信息采样的估算行数,不是真实值,8.0 存在 mysql.innodb_index_stats;filtered 表示经 where 过滤后剩余比例,rows×filtered 用来估算给上层算子的行数;Extra 最关键: Using index=覆盖索引, Using index condition=ICP, Using where=回表后引擎层过滤, Using temporary+Using filesort=需要落临时表和外部排序, 8.0.18 后 JOIN 可能出现 Using join buffer (hash join);扫描行多时用 EXPLAIN ANALYZE 拿真实行数和耗时
- 追问: type=index 和 type=ALL 谁快,为什么?；rows 明显估偏时你会怎么处理?；Using temporary 一般在什么查询里出现,怎么消掉?
- 评分标尺: 及格=能说出 type/key/rows/Extra 含义;良好=给出 type 排序和 key_len 计算;优秀=会用 EXPLAIN ANALYZE 与统计信息重采样(ANALYZE TABLE)定位估算偏差
- 常见误区: 把 rows 当成实际扫描行数;只看不比较 filtered 就下结论

### Q: ACID 四个特性分别靠 InnoDB 的什么机制保证?
- 领域: 数据库
- 难度: 中级
- 考察点: 事务底层的机制对应关系,常作为项目题的开场
- 参考答案要点: A 原子性靠 undo log,事务回滚时按 undo 版本链反向补偿,崩溃恢复时未提交事务由 undo 回滚;持久性靠 redo log,WAL 先写日志再刷页,提交时按 innodb_flush_log_at_trx_commit 决定刷盘强度(1=每次提交 fsync,最安全;2=写 page cache 每秒 fsync;0=每秒写盘,宕机可能丢 1 秒);I 隔离性靠 MVCC 读视图加锁规则(行锁/间隙锁)读写分离;D 由 redo+undo 保证已提交数据不丢、未提交数据不残留,再由 doublewrite 保证页本身不因 16KB>原子写单位而撕裂,崩溃后先用 doublewrite 副本修复坏页再重放 redo;需要明确 redo 是物理日志、幂等重放,undo 是逻辑日志、可回滚可构造快照
- 追问: innodb_flush_log_at_trx_commit 设成 2 在什么场景下会丢数据?；为什么需要 doublewrite,关掉它有性能收益但风险在哪?；redo log 写满时会发生什么?
- 评分标尺: 及格=四条特性能对上 undo/redo/MVCC;良好=讲清三种刷盘档位与 doublewrite 的作用;优秀=能说明 redo 检查点、脏页比例 innodb_max_dirty_pages_pct 触发强制刷脏导致写入抖动
- 常见误区: 说"undo 保证原子性所以隔离性也和 undo 无关";把 binlog 当作 InnoDB 的实现机制

### Q: 四种隔离级别分别解决什么问题,MySQL 默认是哪一档?
- 领域: 数据库
- 难度: 中级
- 考察点: 概念与异常术语能否精确对上
- 参考答案要点: 读未提交会出现脏读(读到别事务未提交的数据);读已提交避免脏读,但同一事务内两次读同一行结果不同,称不可重复读,由 MVCC 每次 select 生成新 ReadView 实现;可重复读避免不可重复读,InnoDB 在 RR 下事务首次快照读时生成 ReadView 并复用,同时用 Next-Key Lock(记录锁+间隙锁)在当前读场景下锁住区间,大部分消除幻读;串行化把读也加共享锁退化为并发最差;MySQL 默认是 REPEATABLE-READ,与 SQL 标准不同;要严格杜绝幻读需 select for update 走当前读;RR 是 InnoDB 的"快照读+当前读"组合,并非完全无幻读,快照读与当前读混用会出现"自己刚插入的行看不见/看得见"的观感不一致
- 追问: 脏读、不可重复读、幻读的边界例子各给一个?；为什么 InnoDB 选 RR 而不是 RC 作为默认,主从复制上有什么考虑?；线上把隔离级别调成 RC 会影响什么?
- 评分标尺: 及格=四档与三种异常对应正确;良好=说清 ReadView 生成时机在 RC/RR 的差异;优秀=能解释 RR 下仍可能幻读的场景和 binlog 格式与 RC 的关系
- 常见误区: 把不可重复读和幻读混为一谈;认为 RR 完全杜绝幻读

### Q: 讲讲 MVCC 的实现,undo 版本链和 ReadView 怎么配合?
- 领域: 数据库
- 难度: 高级
- 考察点: 并发控制核心机制,区分背题与读懂源码
- 参考答案要点: 每行隐藏列 DB_TRX_ID(最近修改它的事务号)和 DB_ROLL_PTR(指向 undo log 里的上一版本),多次修改串成版本链;ReadView 四个字段:m_ids(生成时活跃的事务 id 集合)、min_trx_id(最小活跃)、max_trx_id(下一个将分配的事务号)、creator_trx_id;可见性判断:行的 trx_id==creator 可见;小于 min_trx_id 说明已提交,可见;大于等于 max_trx_id 说明是本快照之后开启的事务,不可见;落在 m_ids 中说明未提交,不可见;不可见则沿 roll_ptr 往前找上一版本重新判断,直到找到可见版本或链尽头;RC 每条 select 语句生成新 ReadView,RR 只在事务第一次快照读生成并复用;update/delete/select for update 是当前读,读最新版本并加锁
- 追问: 为什么 RR 下 A 事务改了自己看不到的行不会冲突,当前读和快照读看到不同版本怎么解释?；undo 版本链太长会怎样,purge 线程和 long transaction 有什么关系?；ReadView 能不能复用,RC 复用会有什么问题?
- 评分标尺: 及格=能说出 undo 版本链 + ReadView 两个部件;良好=讲清四个字段与可见性判定顺序;优秀=能指出长事务导致 undo 膨胀、purge 滞后、回滚段巨大,并给出监控 information_schema.innodb_trx 的做法
- 常见误区: 说 MVCC 靠加读锁实现;把 ReadView 记成"数据快照副本"(实际是事务可见性判定,数据靠版本链)

## 锁与日志

### Q: 行锁、间隙锁、临键锁分别锁什么,什么时候会加间隙锁?
- 领域: 数据库
- 难度: 高级
- 考察点: 锁规则是否建立在索引与隔离级别两个前提上
- 参考答案要点: 记录锁锁单行,间隙锁锁索引记录之间的开区间、只阻塞插入不阻塞读,临键锁(Next-Key Lock)=记录锁+其前间隙,是 RR 下的基本加锁单位;加锁单位为索引记录,未被索引命中的 where 条件会在 server 层过滤但仍可能已锁到扫描过的行,所以要用合适索引把扫描范围收窄;RR 下唯一索引等值命中已存在记录退化为记录锁,命中不存在记录加间隙锁,普通索引等值命中加临键锁+下一个间隙;insert 遇到间隙锁被阻塞时按 innodb_lock_wait_timeout 默认 50 秒超时报 ERROR 1205;RC 不加间隙锁,靠 binlog row 格式保证主从一致;insert intention lock 与间隙锁冲突是插入被阻塞的直接原因
- 追问: 为什么唯一索引等值查询反而锁得最少?；RR 下间隙锁会带来什么线上问题,怎么定位?；把隔离级别降到 RC,主从复制需要注意什么?
- 评分标尺: 及格=三种锁的定义正确;良好=能说出加锁单位是索引、唯一/普通索引差异;优秀=提到 insert intention lock、SHOW ENGINE INNODB STATUS 的 LATEST DETECTED DEADLOCK 与 performance_schema.data_locks 排查手段
- 常见误区: 说间隙锁会阻塞其他事务的 select;认为锁的是"表的一行数据地址"

### Q: 死锁的四个必要条件是什么,MySQL 怎么检测和避免?
- 领域: 数据库
- 难度: 高级
- 考察点: 能把理论四条件落到 InnoDB 的实现与工程实践
- 参考答案要点: 互斥、持有并等待、不可剥夺、循环等待,破坏任一即可预防;InnoDB 默认 innodb_deadlock_detect=ON,用 wait-for graph 检测环,发现死锁后回滚 undo 量(trx 修改行数×权重)最小的事务并报 ERROR 1213,业务需能重试;另一种策略是关检测改用 innodb_lock_wait_timeout=50 秒超时,代价是热点行并发高时全量排队、吞吐坍塌;工程上避免的手法:多行更新按固定顺序(如主键升序)加锁、事务尽量短小且不要在事务里做 RPC、大事务拆小并用索引精确命中、用 update ... where id=? 而不是先 select 再 update、必要时用 SELECT ... FOR UPDATE SKIP LOCKED(MySQL 8.0)做队列抢占;热点账户场景可改乐观锁版本号或队列化合并更新
- 追问: 死锁检测和超时回滚两种方案分别的代价是什么?；给一个 RR 下两条 update 交叉导致死锁的具体例子?；MySQL 8.0 的 SKIP LOCKED 适合什么业务?
- 评分标尺: 及格=四条件与 1213 回滚代价;良好=能给出按序加锁与缩短事务的具体做法;优秀=能讲清热点更新排队退化、innodb_undo 与超时策略的取舍及监控手段
- 常见误区: 说"MySQL 靠超时避免死锁"(超时只是兜底);认为加了索引就不会死锁

### Q: redo log、undo log、binlog 有什么区别,为什么要两阶段提交?
- 领域: 数据库
- 难度: 高级
- 考察点: 日志体系与崩溃恢复一致性,高频深挖题
- 参考答案要点: redo log 是 InnoDB 引擎层的物理日志、循环写入 ib_logfile(8.0.30 起默认 innodb_log_file_size 48MB×2),只保证已提交事务的页修改可重放;undo log 是逻辑日志,用于回滚与 MVCC 版本链;binlog 是 server 层的归档逻辑日志、追加写、记录语句或行变更,用于主从复制与时间点恢复;两阶段提交:redo 先写 prepare 并落盘→写 binlog 并落盘→redo 提交,任何点崩溃都能判定:redo 有 prepare 且 binlog 完整则提交,binlog 缺失则回滚;目的不是让日志"写两遍",而是保证 redo(内部一致性)与 binlog(外部备份/复制)不出现"备份库多/少一条变更"的不一致;若先写 binlog 再提交 redo,崩溃后主库回滚而从库已应用,数据分叉
- 追问: 为什么不能先写完 redo 提交再写 binlog?；组提交(group commit)是怎么在安全性不变的前提下提高吞吐的?；sync_binlog=1 和 innodb_flush_log_at_trx_commit=1 分别控制什么,双 1 的性能代价有多大?
- 评分标尺: 及格=三种日志的层次与用途分清;良好=能复述 prepare/binlog/commit 顺序与崩溃判定;优秀=讲清 binlog_group_commit_sync_delay、双 1 的 fsync 次数与崩溃安全的必要性
- 常见误区: 说 redo log 用于回滚;认为 binlog 是引擎层日志

## 工程实践

### Q: 为什么很多团队强制要求用自增主键,而不是 UUID?
- 领域: 数据库
- 难度: 中级
- 考察点: 对 B+树插入局部性与页分裂的理解
- 参考答案要点: 自增主键的新行总是追加在最右叶子页尾部,顺序写、页填满即开新页,几乎不产生页分裂,写放大与随机 I/O 最小;UUID 单调性缺失,插入落在树中间,频繁触发页分裂,造成大量空洞(InnoDB 页填充后难以回收,需 OPTIMIZE TABLE 或重建),实测插入吞吐常降到顺序主键的三分之一以下,并且空间膨胀;主键会被所有二级索引叶子复制,InnoDB 推荐 BIGINT UNSIGNED(8 字节) 而非 CHAR(36) 的 UUID 字符串,索引体积随之放大;非业务含义主键避免唯一索引语义变化牵连二级索引;分布式场景需要全局唯一时用雪花 ID 或号段模式,保证趋势递增以保留局部性,而不是裸 UUID;也可用 UUID 但排序版本(UUIDv7)或函数索引存二进制 BINARY(16)
- 追问: 页分裂之后原来的空洞为什么不容易被复用?；主键值 UPDATE 的代价有多大?；分库分表下自增主键冲突怎么处理?
- 评分标尺: 及格=答到顺序追加、避免页分裂;良好=给出主键被二级索引复制带来的空间放大与 8 字节量级;优秀=能提出趋势递增的分布式 ID 方案并说明空洞回收与表重建的代价
- 常见误区: 说"自增主键是为了可读性";认为 UUID 只是长一点、性能差别不大

### Q: 生产环境给一张两亿行的大表加索引,你会怎么做?
- 领域: 数据库
- 难度: 高级
- 考察点: 变更风险意识,能否说出方案与参数
- 参考答案要点: 先确认能否 Online DDL:InnoDB 加二级索引可用 ALGORITHM=INPLACE, LOCK=NONE,不拷贝全表、只重建索引树,但期间仍需排他元数据锁(MDL),长查询持有 MDL 会让 DDL 阻塞并连带堵住后续所有请求;稳妥做法是低峰执行、先 SET SESSION lock_wait_timeout 很短让 DDL 抢不到 MDL 时快速失败、并 kill 长事务;必须改主键或列类型时只能走表拷贝,用 pt-online-schema-change(影子表 + 触发器增量同步 + rename 切换)或 gh-ost(伪装从库拉 binlog 增量,不用触发器,可控暂停与限流);变更窗口内注意复制延迟(从库单线程回放大索引构建会滞后)、磁盘空间需要预留约 1.2 倍表大小、binlog 保留策略;回滚方案:gh-ost 保留原表 rename、pt 用 --dry-run 与 --no-drop-old-table
- 追问: Online DDL 为什么还会造成写入阻塞或超时?；MDL 排队怎么排查,该 kill 谁?；gh-ost 相比 pt-osc 的核心优势在哪?
- 评分标尺: 及格=知道 Online DDL 不锁表但仍需评估;良好=说清 MDL 风险与 pt-osc/gh-ost 的原理差别;优秀=补充空间、复制延迟、限流参数与回滚预案
- 常见误区: 认为 Online DDL 全程无阻塞、随手就能执行;忘了影子表方案需要唯一键做增量对齐

### Q: 分库分表的分片键怎么选,跨分片查询有哪些痛点?
- 领域: 系统设计
- 难度: 高级
- 考察点: 数据架构取舍,是否理解"分片键决定查询能力"
- 参考答案要点: 分片键要覆盖高频查询条件、分布均匀、不可变,常选 user_id/tenant_id 取模或一致性哈希;按 user_id 分片后,按订单号查就得全分片扫描,解决方案是基因法(把 user_id 低位嵌入 order_id 尾部)或映射表/ES 做异构检索;跨分片痛点:聚合与 count 需各分片汇总、join 无法在库内完成(改冗余字段或绑定表让父子同键同算法)、分布式事务(退化为最终一致 + 本地消息表/TCC/Seata AT)、order by limit 需各分片取 TopN 再归并、深分页代价被分片数放大;扩容:取模方案需全量搬迁,一致性哈希加虚拟节点或预留 2 的幂次分片可把迁移量降到翻倍级别;全局唯一 id 用雪花或号段
- 追问: 为什么绑定表要用同一个分片键?；跨分片 order by + limit 10000 为什么危险,怎么改?；单表已经 5 亿行但读写尚可,你会先做什么再决定分表?
- 评分标尺: 及格=能给出分片键选择的三条原则;良好=说清跨分片排序/聚合/join/分布式事务四类痛点及对应手段;优秀=能讲基因法 ID、扩容搬迁路径和"先归档/冷热分离再分片"的顺序判断
- 常见误区: 认为分片能解决所有慢查询;把分布式事务当作分库分表后的默认方案

### Q: 一条 SQL 从 200ms 慢到 3 秒,你的排查步骤是什么?
- 领域: 数据库
- 难度: 中级
- 考察点: 是否有系统化的定位路径而非瞎猜
- 参考答案要点: 先确认范围:是偶发还是稳定变慢,同期是否只有这一条;开慢查询日志 long_query_time(默认 10 秒,线上常调 200ms 甚至更低)抓样本,用 mysqldumpslow/pt-query-digest 按总耗时排序而非单次;看是否统计信息失真导致执行计划突变,EXPLAIN 对比,必要时 ANALYZE TABLE 重采样,检查 rows 估算与真实值差多少倍;排除锁等待:information_schema.innodb_trx、performance_schema.data_lock_waits、sys.innodb_lock_waits,长事务或备份任务持 MDL;排除资源与配置:buffer pool 命中率下降(新上大表把热数据挤出)、磁盘 fsync 变慢、redo 写满触发激进刷脏、tmp_table_size/max_heap_table_size 不够导致落盘临时表;确认数据量与索引匹配度,注意"计划没变但数据倾斜了";改动引入用 SQL 指纹与版本上线时间对齐
- 追问: 执行计划突然变了有哪些常见触发原因?；如果是锁等待,你怎么定位到具体的持锁 SQL?；buffer pool 命中率怎么观测,掉了会怎么表现?
- 评分标尺: 及格=有 EXPLAIN + 慢日志的基本路径;良好=能分层区分计划、锁、资源、统计信息;优秀=给出具体视图/工具名和"按计划、按锁、按资源三张时间线对齐"的方法
- 常见误区: 上来就说"加索引";只看单次执行不看整体耗时占比

### Q: 连接池有哪些关键参数,连接耗尽时应用是什么现象?
- 领域: 数据库
- 难度: 中级
- 考察点: 应用侧配置能力,常与线上故障关联
- 参考答案要点: 服务端 max_connections 默认 151(8.0 起预留 1 个给 admin 的额外连接),超过报 ERROR 1040;每连接按 thread_stack、连接 buffer、临时表分配内存,大池不等于高性能;池侧核心参数 HikariCP 的 maximumPoolSize、minimumIdle、connectionTimeout(默认 30 秒)、maxLifetime(默认 30 分钟,必须小于服务端 wait_timeout 默认 28800 秒)、idleTimeout,配 keepaliveTime 防中间设备断链;池耗尽表现为获取连接超时(HikariCP 抛 SQLTransientConnectionException: Connection is not available, request timed out after 30000ms),吞吐断崖,线程栈大量等待 getConnection;根因多为慢 SQL 或未关闭连接/事务未提交,应查 SHOW PROCESSLIST 里 Sleep 且 Time 很大的连接;池大小经验值 poolSize≈核数×2+磁盘数,而不是几百
- 追问: maxLifetime 为什么必须小于 wait_timeout?；连接数打满时你改大 max_connections 还是查 SQL,判断依据是什么?；为什么连接池不是越大越好?
- 评分标尺: 及格=能说出 3 个以上参数及 1040 报错;良好=讲清 maxLifetime 与 wait_timeout 关系和耗尽现象;优秀=给出池大小估算依据、上下文泄漏定位路径(连接持有时间指标、慢事务审计)
- 常见误区: 认为连接耗尽一定是数据库挂了;把 max_connections 调成几千来"解决问题"

### Q: count(*)、count(1)、count(列) 有什么区别,哪个快?
- 领域: 数据库
- 难度: 初级
- 考察点: 细节理解,是否能打破常见谣传
- 参考答案要点: count(*) 和 count(1) 都是统计满足条件的行数,都不忽略 NULL,语义完全一致,MySQL 优化器把 count(*) 视为行计数,不会展开所有列,执行效率无差异;count(列) 要读取该列并排除 NULL,代价更高;count(列) 若该列恰好是 NOT NULL 的索引列,优化器仍可能选最小可用二级索引扫描(InnoDB 会挑 index 中记录最紧凑的树),这比聚簇索引全扫快;count(*) 没有缓存精确值,InnoDB 靠并行的索引统计,官方明确高并发精确 count 需 select count(*) 走事务一致性视图;MyISAM 有保存的全表行数所以无 where 的 count(*) 是 O(1),这是它被 InnoDB 取代的原因之一;分页总数建议做估算或异步统计或按页缓存
- 追问: 为什么 count(主键) 可能比 count(*) 慢?；InnoDB 无 where 的 count(*) 到底扫什么?；一亿行的表要做总数展示,你怎么办?
- 评分标尺: 及格=答到 count(列) 忽略 NULL、前两者等价;良好=能说明优化器选最小索引与 MyISAM 的差异;优秀=给出大表计数的工程替代方案(估算、异步计数表、按分区统计)
- 常见误区: 说 count(1) 比 count(*) 快或 count(*) 会展开列;认为 count(*) 在有主键时一定扫聚簇索引

### Q: 乐观锁和悲观锁在代码和数据库层面怎么落地?
- 领域: 数据库
- 难度: 中级
- 考察点: 并发更新方案选型与实现细节
- 参考答案要点: 悲观锁用 select ... for update 加行锁(当前读,读最新版本并阻塞别人修改),业务再 update,必须在事务内,并发高时排队,注意超时 innodb_lock_wait_timeout=50 秒与死锁;也可用 update ... where id=? and status=0 的原子条件更新,一条语句完成"检查+修改",依赖行锁避免竞态,这是最轻量的悲观做法;乐观锁加 version 或 update_time 列,update t set stock=stock-1,version=version+1 where id=? and version=?,由应用判断 affected rows 是否为 0 决定重试;重试策略要有上限与退避,热点行乐观锁冲突率极高时反而退化;Redis 分布式锁不是数据库锁替代品,存在续期与主从切换丢锁问题;余额扣减这类场景可用队列串行化或 CAS 分桶(stock 拆多行)降低争抢
- 追问: version 字段用什么类型、会不会溢出?；乐观锁冲突率高的判断指标是什么,该转悲观还是转架构?；select for update 不加索引会锁什么?
- 评分标尺: 及格=两种锁的 SQL 写法正确;良好=指出乐观锁靠 affected rows 判定、悲观锁必须事务包裹;优秀=能按冲突率给方案并说明分桶/串行化的收益与一致性代价
- 常见误区: 先 select version 再 update 分两步写(竞态仍在);认为 for update 不加索引也只锁一行

### Q: InnoDB 的 Buffer Pool、Change Buffer 和 Doublewrite 各解决什么问题?
- 领域: 数据库
- 难度: 高级
- 考察点: 存储引擎调优的底层知识,拉开差距的题
- 参考答案要点: Buffer Pool 缓存数据页与索引页,默认 innodb_buffer_pool_size 128MB(生产常给物理内存 50%~70%),按 8KB/页 的 LRU 管理并分区(innodb_buffer_pool_instances 默认 8),采用改良 LRU 有 young/old 区,innodb_old_blocks_time=1000ms 防止全表扫描把热页挤出;Doublewrite Buffer 解决"页撕裂":InnoDB 页 16KB 大于 OS 原子写单位 4KB/8KB,写脏页时先整批顺序写到 doublewrite 文件区(默认 2MB)再写数据文件,崩溃后坏页可用副本还原,否则 redo 重放会失败;Change Buffer 针对非唯一二级索引的写,若目标页不在内存,把变更缓存在 change buffer(自 MySQL 8.0.13 合并进 buffer pool 且默认 innodb_change_buffering 仍为 all 但受只读事务等限制),读该页时 merge,把随机写变成对缓存顺序操作,前提是页不在内存,唯一索引因需判重不能变更缓冲;AHI 自适应哈希索引加速等值定位
- 追问: 为什么 doublewrite 会影响写吞吐,MySQL 8.0 有办法关掉它吗?；全表扫描为什么没把热数据挤掉?；change buffer 对唯一索引为什么无效?
- 评分标尺: 及格=三个部件用途说清;良好=给出 16KB 页与 OS 原子写单位的关系、LRU old 区防污染机制;优秀=能讨论 innodb_flush_neighbors、SSD 下 doublewrite 与 change buffer 的收益变化及监控指标
- 常见误区: 说 change buffer 是"写缓冲日志"(它是页内缓存结构,不是 redo);认为 buffer pool 命中率低只需加大内存
