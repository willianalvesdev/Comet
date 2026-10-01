import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch
from scripts import console_servidor as launcher

class FrontendBuildTests(unittest.TestCase):
    def test_installs_when_lock_changes_and_skips_when_current(self):
        with TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'package-lock.json').write_text('first')
            (root/'node_modules/typescript/bin').mkdir(parents=True)
            (root/'node_modules/typescript/bin/tsc').touch()
            with patch.object(launcher,'ROOT',root), patch.object(launcher.shutil,'which',return_value='npm'), patch.object(launcher.subprocess,'run',return_value=Mock(returncode=0)) as run:
                self.assertTrue(launcher.build_frontend())
                self.assertEqual([call.args[0][1] for call in run.call_args_list],['ci','run'])
                run.reset_mock()
                self.assertTrue(launcher.build_frontend())
                self.assertEqual([call.args[0][1] for call in run.call_args_list],['run'])
                (root/'package-lock.json').write_text('second')
                run.reset_mock()
                self.assertTrue(launcher.build_frontend())
                self.assertEqual([call.args[0][1] for call in run.call_args_list],['ci','run'])

    def test_failed_restart_does_not_stop_running_server(self):
        process=Mock()
        with patch.object(launcher,'build_frontend',side_effect=[True,False]), patch.object(launcher,'start_server',return_value=process) as start, patch.object(launcher,'stop_server') as stop:
            def command():
                self.assertEqual(stop.call_count,0)
                return 'r' if launcher.build_frontend.call_count == 1 else 's'
            with patch('builtins.input',side_effect=command):
                launcher.main()
            start.assert_called_once_with(open_browser=True)
            stop.assert_called_once_with(process)

    def test_successful_restart_builds_before_stop(self):
        calls=[]
        with patch.object(launcher,'build_frontend',side_effect=lambda:calls.append('build') or True), patch.object(launcher,'start_server',side_effect=lambda **kwargs:calls.append('start') or Mock()), patch.object(launcher,'stop_server',side_effect=lambda p:calls.append('stop')), patch('builtins.input',side_effect=['r','s']):
            launcher.main()
        self.assertEqual(calls,['build','start','build','stop','start','stop'])

    def test_initial_failure_does_not_start_server(self):
        with patch.object(launcher,'build_frontend',return_value=False), patch.object(launcher,'start_server') as start:
            self.assertEqual(launcher.main(),1)
            start.assert_not_called()

    def test_missing_node_is_reported(self):
        with patch.object(launcher.shutil,'which',return_value=None), patch.object(launcher.subprocess,'run') as run:
            self.assertFalse(launcher.build_frontend())
            run.assert_not_called()
    @unittest.skipUnless(launcher.os.name == 'nt','Windows mutex')
    def test_duplicate_instance_is_rejected_until_mutex_is_released(self):
        with TemporaryDirectory() as directory, patch.object(launcher,'ROOT',Path(directory)):
            first=launcher.acquire_instance()
            self.assertIsNotNone(first)
            try:
                self.assertIsNone(launcher.acquire_instance())
            finally:
                first[0].CloseHandle(first[1])
            reopened=launcher.acquire_instance()
            self.assertIsNotNone(reopened)
            reopened[0].CloseHandle(reopened[1])
