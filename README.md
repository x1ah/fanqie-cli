# Fanqie CLI

在终端里管理番茄小说：上传本地章节、保存草稿、提交审核，也能管理分卷、修改草稿和更新简介。

支持 Markdown 和 TXT 文件，可以管理多本书。首次需要用浏览器登录，之后通常不用打开网页。

**上传只会保存草稿；需要发布时，再单独提交审核。**

## 安装

先安装 [Node.js](https://nodejs.org/) 22 或更高版本，以及 Google Chrome。然后在终端运行：

```bash
npm install -g 'git+https://github.com/x1ah/fanqie-cli.git#v0.5.3'
fanqie --help
```

其他浏览器的配置方法见[使用说明](docs/commands.md#浏览器设置)。

## 第一次使用

先在番茄作家后台创建好作品和第一卷。下面以一本书为例：

```bash
mkdir -p 我的写作目录/新书/正文/第一卷
cd 我的写作目录
fanqie init
fanqie add 新书 --title '后台实际书名' --source './新书/正文'
fanqie login
```

浏览器打开后，手动完成登录，再回终端按回车。

接着，告诉工具这本书和第一卷在后台的位置。将下面的网址替换为自己作品的章节管理页地址，卷名也要与后台一致：

```bash
fanqie bind 新书 \
  --url 'https://fanqienovel.com/main/writer/chapter-manage/123456789' \
  --volume 第一卷 --remote-volume '第一卷：开篇'
```

`新书` 是你给作品起的简称，后续命令都用它。

## 准备章节

将正文保存为 `新书/正文/第一卷/第001章_出发.md`，内容格式如下：

```text
# 第001章 出发

这里是小说正文。

另起一段，空一行即可。
```

文件名和第一行的章号、章名要一致。全书章号连续，换卷后不从第1章重新编号。正文只放文字段落，不放排版标记和写作笔记。TXT 文件也可以，第一行可省略 `#`。

## 上传和发布

先检查，再保存到草稿箱：

```bash
fanqie check 新书 --volume 第一卷 --chapters 1
fanqie upload 新书 --volume 第一卷 --chapters 1
```

工具会检查后台保存的标题、正文和分卷是否正确。上传成功后，章节仍是草稿。

确认要发布时，提交审核并查询结果：

```bash
fanqie publish 新书 --volume 第一卷 --chapters 1 --use-ai yes
fanqie publish-status 新书 --volume 第一卷 --chapters 1
```

`--use-ai yes` 表示使用了 AI，未使用则填 `no`，请按实际情况填写。结果中的 `reviewing` 表示审核中，`published` 才表示已发布。

一次处理多章时，把 `--chapters 1` 改成 `--chapters 1-3`。更多操作见[使用说明](docs/commands.md)，包括预览、修改草稿、调整草稿所在分卷和更新简介。

## 使用时注意

- 登录信息保存在写作目录的 `.fanqie/` 中。不要分享这个文件夹；使用 Git 时，将它加入 `.gitignore`。
- 遇到超时或结果不确定时，先按[故障处理](docs/troubleshooting.md)查询，不要直接重复上传或提交。
- 目前不支持定时发布、收费设置、作者有话说，以及修改或移动已发布章节。

本工具由社区独立维护，并非番茄官方产品。它使用作家网页的接口，网站调整后可能需要更新。

## 其他文档

[使用说明](docs/commands.md) · [故障处理](docs/troubleshooting.md) · [参与开发](CONTRIBUTING.md) · [安全说明](SECURITY.md) · [更新记录](CHANGELOG.md)

采用 [MIT 许可证](LICENSE)。
