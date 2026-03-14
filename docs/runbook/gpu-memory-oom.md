# GPU 显存不足（OOM）排查

适用场景：
- 本地模型、vLLM、SGLang、训练或推理任务因为显存不足失败
- 程序报 CUDA OOM、显存分配失败、模型加载失败
- 需要快速判断是模型太大、并发过高还是显存碎片问题

症状：
- `CUDA out of memory`
- 模型启动后马上退出
- 请求一多就报显存不足
- `nvidia-smi` 显示显存占满

快速判断：

```bash
nvidia-smi
watch -n 1 nvidia-smi
```

修复步骤：

1. 确认是哪一个进程占用显存

```bash
nvidia-smi
```

2. 判断问题类型
- 启动即 OOM：模型太大或量化不合适
- 并发时 OOM：batch、上下文长度或并发过高
- 跑一段时间才 OOM：缓存堆积或显存碎片

3. 最小化止血动作
- 降低并发
- 降低 batch size
- 降低上下文长度
- 切更小模型或量化模型
- 释放无关进程

4. 排查框架参数
- vLLM：检查并发、上下文、GPU 内存利用率相关参数
- 推理服务：检查 KV cache 与 max tokens
- 训练作业：检查 batch、gradient accumulation、mixed precision

5. 释放异常进程
- 先确认不是关键业务进程，再结束：

```bash
kill PID
```

回滚：
- 恢复上一个稳定模型或稳定参数配置
- 如果是新版本引发 OOM，回滚镜像或回滚服务参数

验证：
- 服务可稳定启动
- `nvidia-smi` 使用量进入可控区间
- 连续多次请求不再报 OOM

风险提示：
- 不要直接 kill 不明 GPU 进程
- 大模型切换、长上下文和高并发经常同时触发 OOM
- 仅靠重启解决不了参数配置导致的持续 OOM

关键词：
- gpu oom
- cuda out of memory
- 显存不足
- nvidia-smi
- vllm oom
- sglang oom
- 模型加载失败
- gpu memory

