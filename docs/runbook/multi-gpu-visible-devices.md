# 多 GPU 可见性与设备选择

适用场景：
- 单机有多张 GPU，需要限制服务使用其中一部分
- 需要排查“服务跑错卡”“多实例抢同一张卡”
- 需要在容器或宿主机上控制 GPU 可见范围

症状：
- 模型进程占错 GPU
- 多个服务互相抢卡
- 预期只用一张卡，实际用到了全部 GPU

快速判断：

```bash
nvidia-smi
echo $CUDA_VISIBLE_DEVICES
```

修复步骤：

1. 明确目标卡号
- 先用 `nvidia-smi` 看 GPU index、显存和占用情况

2. 宿主机限制

```bash
export CUDA_VISIBLE_DEVICES=0
```

多卡：

```bash
export CUDA_VISIBLE_DEVICES=0,1
```

3. 容器限制
- 在容器运行参数或编排配置中显式限制 GPU

4. 服务化部署
- 在 systemd、容器环境变量或启动脚本中固定 `CUDA_VISIBLE_DEVICES`

回滚：
- 恢复旧的可见设备配置
- 重启服务让环境变量重新生效

验证：
- 进程只出现在预期 GPU 上
- `nvidia-smi` 显示显存占用符合预期

风险提示：
- 逻辑卡号和物理卡号要确认清楚
- 多服务共机时必须显式分配 GPU 边界

关键词：
- multi gpu
- cuda visible devices
- gpu selection
- nvidia-smi
- 多卡分配
- 显卡选择
- gpu 隔离
- cuda_visible_devices

