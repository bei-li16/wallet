package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestWriteReadTextFileRoundTrip 验证桌面壳的文件读写绑定（CSV 同步/导入的真实路径）
func TestWriteReadTextFileRoundTrip(t *testing.T) {
	app := NewApp()
	dir := t.TempDir()
	p := filepath.Join(dir, "wallet-expenses.csv")
	// 与前端 buildCSVContent 输出一致的形态：BOM + CRLF + 引号字段
	content := "\uFEFFid,amount,category,subcategory,date,note,createdAt,updatedAt\r\n" +
		"\"abc\",12.5,\"餐饮\",\"午餐\",\"2026-09-01\",\"含\"\"引号\",1,2\r\n"

	if err := app.WriteTextFile(p, content); err != nil {
		t.Fatalf("写入失败: %v", err)
	}
	got, err := app.ReadTextFile(p)
	if err != nil {
		t.Fatalf("读取失败: %v", err)
	}
	if got != content {
		t.Fatalf("往返内容不一致:\n got=%q\nwant=%q", got, content)
	}

	if err := app.WriteTextFile("", "x"); err == nil {
		t.Fatal("空路径应返回错误")
	}
	if _, err := app.ReadTextFile(filepath.Join(dir, "不存在.csv")); err == nil {
		t.Fatal("读不存在的文件应返回错误")
	}
}

// TestDefaultCsvPath 验证默认同步路径指向真实存在的文档目录
func TestDefaultCsvPath(t *testing.T) {
	app := NewApp()
	p, err := app.DefaultCsvPath()
	if err != nil {
		t.Fatalf("DefaultCsvPath: %v", err)
	}
	if !strings.HasSuffix(p, "wallet-expenses.csv") {
		t.Fatalf("文件名不符合约定: %q", p)
	}
	if st, err := os.Stat(filepath.Dir(p)); err != nil || !st.IsDir() {
		t.Fatalf("文档目录不存在: %v", err)
	}
	t.Logf("默认同步路径: %s", p)
}

// TestDocumentsDirFallback 验证注册表读取失败时回退 %USERPROFILE%\Documents
func TestDocumentsDirFallback(t *testing.T) {
	dir, err := documentsDir()
	if err != nil {
		t.Fatalf("documentsDir: %v", err)
	}
	if st, err := os.Stat(dir); err != nil || !st.IsDir() {
		t.Fatalf("回退目录无效: %q (%v)", dir, err)
	}
}

// TestExitGate 验证退出拦截判定：干净态直接关、脏态询问、放行后不再询问
func TestExitGate(t *testing.T) {
	app := NewApp()
	if app.shouldAskExit() {
		t.Fatal("干净状态不应弹窗询问")
	}
	app.SetUnsynced(true)
	if !app.shouldAskExit() {
		t.Fatal("有未同步修改应弹窗询问")
	}
	app.allowExit = true
	if app.shouldAskExit() {
		t.Fatal("已放行后不应再次询问")
	}
	app.SetUnsynced(false)
	if app.shouldAskExit() {
		t.Fatal("放行后无论脏净都不应询问")
	}
}
